import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface WorkerDetails {
  name: string;
  description: string;
  role: string;
  skills: string[];
  registrationTimestamp: number;
  lastUpdateTimestamp: number;
  verified: boolean;
  active: boolean;
  verificationNotes: string | null;
  employer: string | null;
}

interface StatusHistory {
  status: string;
  timestamp: number;
  updater: string;
}

interface ContractState {
  workers: Map<string, WorkerDetails>;
  statusHistory: Map<string, Map<number, StatusHistory>>;
  admins: Map<string, boolean>;
  paused: boolean;
  admin: string;
  workerCounter: number;
  statusUpdateCounters: Map<string, number>;
}

// Mock contract implementation
class WorkerRegistryMock {
  private state: ContractState = {
    workers: new Map(),
    statusHistory: new Map(),
    admins: new Map([["deployer", true]]),
    paused: false,
    admin: "deployer",
    workerCounter: 0,
    statusUpdateCounters: new Map(),
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_ALREADY_REGISTERED = 101;
  private ERR_INVALID_INPUT = 102;
  private ERR_WORKER_NOT_FOUND = 103;
  private ERR_INVALID_ROLE = 104;
  private ERR_PAUSED = 105;
  private ERR_INVALID_STATUS = 106;
  private ERR_MAX_LENGTH_EXCEEDED = 107;
  private ERR_INACTIVE_WORKER = 108;
  private ERR_ALREADY_VERIFIED = 109;

  private MAX_NAME_LEN = 100;
  private MAX_DESCRIPTION_LEN = 500;
  private MAX_ROLE_LEN = 50;
  private MAX_SKILLS = 10;
  private MAX_SKILL_LEN = 30;

  private ROLE_WORKER = "worker";
  private ROLE_SUPERVISOR = "supervisor";
  private ROLE_ADMIN = "admin";

  private getBlockHeight(): number {
    return Date.now(); // Mock block height
  }

  getWorkerDetails(worker: string): ClarityResponse<WorkerDetails | null> {
    return { ok: true, value: this.state.workers.get(worker) ?? null };
  }

  isWorkerRegistered(worker: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.workers.has(worker) };
  }

  isWorkerVerified(worker: string): ClarityResponse<boolean> {
    const details = this.state.workers.get(worker);
    return { ok: true, value: details ? details.verified : false };
  }

  isWorkerActive(worker: string): ClarityResponse<boolean> {
    const details = this.state.workers.get(worker);
    return { ok: true, value: details ? details.active : false };
  }

  getWorkerRole(worker: string): ClarityResponse<string | null> {
    const details = this.state.workers.get(worker);
    return { ok: true, value: details ? details.role : null };
  }

  getStatusHistory(worker: string, updateId: number): ClarityResponse<StatusHistory | null> {
    const history = this.state.statusHistory.get(worker);
    return { ok: true, value: history ? history.get(updateId) ?? null : null };
  }

  getStatusUpdateCount(worker: string): ClarityResponse<number> {
    return { ok: true, value: this.state.statusUpdateCounters.get(worker) ?? 0 };
  }

  isAdmin(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.admins.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  registerWorker(
    caller: string,
    name: string,
    description: string,
    role: string,
    skills: string[]
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (this.state.workers.has(caller)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }
    if (
      name.length > this.MAX_NAME_LEN ||
      description.length > this.MAX_DESCRIPTION_LEN ||
      role.length > this.MAX_ROLE_LEN ||
      ![this.ROLE_WORKER, this.ROLE_SUPERVISOR, this.ROLE_ADMIN].includes(role) ||
      skills.length > this.MAX_SKILLS ||
      skills.some((s) => s.length > this.MAX_SKILL_LEN)
    ) {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    const timestamp = this.getBlockHeight();
    this.state.workers.set(caller, {
      name,
      description,
      role,
      skills,
      registrationTimestamp: timestamp,
      lastUpdateTimestamp: timestamp,
      verified: false,
      active: true,
      verificationNotes: null,
      employer: null,
    });
    this.state.workerCounter += 1;
    return { ok: true, value: true };
  }

  updateWorkerProfile(
    caller: string,
    name: string,
    description: string,
    skills: string[]
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const details = this.state.workers.get(caller);
    if (!details) {
      return { ok: false, value: this.ERR_WORKER_NOT_FOUND };
    }
    if (!details.active) {
      return { ok: false, value: this.ERR_INACTIVE_WORKER };
    }
    if (
      name.length > this.MAX_NAME_LEN ||
      description.length > this.MAX_DESCRIPTION_LEN ||
      skills.length > this.MAX_SKILLS ||
      skills.some((s) => s.length > this.MAX_SKILL_LEN)
    ) {
      return { ok: false, value: this.ERR_INVALID_INPUT };
    }
    details.name = name;
    details.description = description;
    details.skills = skills;
    details.lastUpdateTimestamp = this.getBlockHeight();
    return { ok: true, value: true };
  }

  verifyWorker(caller: string, worker: string, notes: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const details = this.state.workers.get(worker);
    if (!details) {
      return { ok: false, value: this.ERR_WORKER_NOT_FOUND };
    }
    if (details.verified) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }
    if (notes.length > 200) {
      return { ok: false, value: this.ERR_MAX_LENGTH_EXCEEDED };
    }
    details.verified = true;
    details.verificationNotes = notes;
    details.lastUpdateTimestamp = this.getBlockHeight();
    return { ok: true, value: true };
  }

  assignEmployer(caller: string, worker: string, employer: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const details = this.state.workers.get(worker);
    if (!details) {
      return { ok: false, value: this.ERR_WORKER_NOT_FOUND };
    }
    if (!(caller === worker || this.state.admins.get(caller))) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (!details.verified) {
      return { ok: false, value: this.ERR_INACTIVE_WORKER };
    }
    details.employer = employer;
    details.lastUpdateTimestamp = this.getBlockHeight();
    return { ok: true, value: true };
  }

  deactivateWorker(caller: string, worker: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const details = this.state.workers.get(worker);
    if (!details || !details.active) {
      return { ok: true, value: false };
    }
    details.active = false;
    details.lastUpdateTimestamp = this.getBlockHeight();
    return { ok: true, value: true };
  }

  updateWorkerStatus(caller: string, worker: string, status: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const details = this.state.workers.get(worker);
    if (!details) {
      return { ok: false, value: this.ERR_WORKER_NOT_FOUND };
    }
    if (!(caller === worker || this.state.admins.get(caller))) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (status.length > 20) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }
    let history = this.state.statusHistory.get(worker);
    if (!history) {
      history = new Map();
      this.state.statusHistory.set(worker, history);
    }
    let count = this.state.statusUpdateCounters.get(worker) ?? 0;
    count += 1;
    history.set(count, {
      status,
      timestamp: this.getBlockHeight(),
      updater: caller,
    });
    this.state.statusUpdateCounters.set(worker, count);
    return { ok: true, value: true };
  }

  addAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admins.set(newAdmin, true);
    return { ok: true, value: true };
  }

  removeAdmin(caller: string, admin: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admins.delete(admin);
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (!this.state.admins.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  admin: "admin_1",
  worker1: "worker_1",
  worker2: "worker_2",
  supervisor: "supervisor_1",
};

describe("WorkerRegistry Contract", () => {
  let contract: WorkerRegistryMock;

  beforeEach(() => {
    contract = new WorkerRegistryMock();
    vi.resetAllMocks();
  });

  it("should allow worker to register with valid inputs", () => {
    const register = contract.registerWorker(
      accounts.worker1,
      "John Doe",
      "Skilled laborer",
      "worker",
      ["farming", "harvesting"]
    );
    expect(register).toEqual({ ok: true, value: true });

    const details = contract.getWorkerDetails(accounts.worker1);
    expect(details).toEqual({
      ok: true,
      value: expect.objectContaining({
        name: "John Doe",
        role: "worker",
        verified: false,
        active: true,
      }),
    });
  });

  it("should prevent registration with invalid role", () => {
    const register = contract.registerWorker(
      accounts.worker1,
      "John Doe",
      "Skilled laborer",
      "invalid_role",
      ["farming"]
    );
    expect(register).toEqual({ ok: false, value: 102 });
  });

  it("should prevent duplicate registration", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const duplicate = contract.registerWorker(accounts.worker1, "Jane Doe", "Desc", "worker", []);
    expect(duplicate).toEqual({ ok: false, value: 101 });
  });

  it("should allow worker to update profile", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Old desc", "worker", ["old_skill"]);
    const update = contract.updateWorkerProfile(accounts.worker1, "John Updated", "New desc", ["new_skill"]);
    expect(update).toEqual({ ok: true, value: true });

    const details = contract.getWorkerDetails(accounts.worker1);
    expect(details).toEqual({
      ok: true,
      value: expect.objectContaining({
        name: "John Updated",
        description: "New desc",
        skills: ["new_skill"],
      }),
    });
  });

  it("should prevent non-registered worker from updating profile", () => {
    const update = contract.updateWorkerProfile(accounts.worker1, "Name", "Desc", []);
    expect(update).toEqual({ ok: false, value: 103 });
  });

  it("should allow admin to verify worker", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const verify = contract.verifyWorker(accounts.deployer, accounts.worker1, "Verified by admin");
    expect(verify).toEqual({ ok: true, value: true });

    const isVerified = contract.isWorkerVerified(accounts.worker1);
    expect(isVerified).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from verifying worker", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const verify = contract.verifyWorker(accounts.worker2, accounts.worker1, "Notes");
    expect(verify).toEqual({ ok: false, value: 100 });
  });

  it("should allow assigning employer", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    contract.verifyWorker(accounts.deployer, accounts.worker1, "Verified");
    const assign = contract.assignEmployer(accounts.worker1, accounts.worker1, accounts.supervisor);
    expect(assign).toEqual({ ok: true, value: true });

    const details = contract.getWorkerDetails(accounts.worker1);
    expect(details).toEqual({
      ok: true,
      value: expect.objectContaining({ employer: accounts.supervisor }),
    });
  });

  it("should prevent assigning employer to unverified worker", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const assign = contract.assignEmployer(accounts.worker1, accounts.worker1, accounts.supervisor);
    expect(assign).toEqual({ ok: false, value: 108 });
  });

  it("should allow admin to deactivate worker", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const deactivate = contract.deactivateWorker(accounts.deployer, accounts.worker1);
    expect(deactivate).toEqual({ ok: true, value: true });

    const isActive = contract.isWorkerActive(accounts.worker1);
    expect(isActive).toEqual({ ok: true, value: false });
  });

  it("should allow updating worker status", () => {
    contract.registerWorker(accounts.worker1, "John Doe", "Desc", "worker", []);
    const updateStatus = contract.updateWorkerStatus(accounts.worker1, accounts.worker1, "available");
    expect(updateStatus).toEqual({ ok: true, value: true });

    const history = contract.getStatusHistory(accounts.worker1, 1);
    expect(history).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "available" }),
    });
  });

  it("should pause and unpause contract", () => {
    const pause = contract.pauseContract(accounts.deployer);
    expect(pause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    const registerDuringPause = contract.registerWorker(accounts.worker1, "Name", "Desc", "worker", []);
    expect(registerDuringPause).toEqual({ ok: false, value: 105 });

    const unpause = contract.unpauseContract(accounts.deployer);
    expect(unpause).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should allow adding and removing admins", () => {
    const addAdmin = contract.addAdmin(accounts.deployer, accounts.admin);
    expect(addAdmin).toEqual({ ok: true, value: true });
    expect(contract.isAdmin(accounts.admin)).toEqual({ ok: true, value: true });

    const removeAdmin = contract.removeAdmin(accounts.deployer, accounts.admin);
    expect(removeAdmin).toEqual({ ok: true, value: true });
    expect(contract.isAdmin(accounts.admin)).toEqual({ ok: true, value: false });
  });

  it("should prevent non-admin from pausing contract", () => {
    const pause = contract.pauseContract(accounts.worker1);
    expect(pause).toEqual({ ok: false, value: 100 });
  });
});