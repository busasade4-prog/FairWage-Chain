;; WorkerRegistry.clar
;; Manages worker registrations for the FairWage Chain system.
;; Handles onboarding, identity verification, profile updates, role assignments, and status management.
;; Designed to be secure, robust, and auditable with event emissions.

;; Constants
(define-constant ERR-UNAUTHORIZED (err u100))
(define-constant ERR-ALREADY-REGISTERED (err u101))
(define-constant ERR-INVALID-INPUT (err u102))
(define-constant ERR-WORKER-NOT-FOUND (err u103))
(define-constant ERR-INVALID-ROLE (err u104))
(define-constant ERR-PAUSED (err u105))
(define-constant ERR-INVALID-STATUS (err u106))
(define-constant ERR-MAX-LENGTH-EXCEEDED (err u107))
(define-constant ERR-INACTIVE-WORKER (err u108))
(define-constant ERR-ALREADY-VERIFIED (err u109))
(define-constant ERR-INVALID-PRINCIPAL (err u110))

(define-constant MAX-NAME-LEN u100)
(define-constant MAX-DESCRIPTION-LEN u500)
(define-constant MAX-ROLE-LEN u50)
(define-constant MAX-SKILLS u10)
(define-constant MAX-SKILL-LEN u30)
(define-constant MAX-NOTES-LEN u200)
(define-constant MAX-STATUS-LEN u20)

(define-constant ROLE-WORKER "worker")
(define-constant ROLE-SUPERVISOR "supervisor")
(define-constant ROLE-ADMIN "admin")

;; Data Maps
(define-map workers
  { worker-principal: principal }
  {
    name: (string-utf8 MAX-NAME-LEN),
    description: (string-utf8 MAX-DESCRIPTION-LEN),
    role: (string-ascii MAX-ROLE-LEN),
    skills: (list MAX-SKILLS (string-ascii MAX-SKILL-LEN)),
    registration-timestamp: uint,
    last-update-timestamp: uint,
    verified: bool,
    active: bool,
    verification-notes: (optional (string-utf8 MAX-NOTES-LEN)),
    employer: (optional principal)
  }
)

(define-map worker-status-history
  { worker-principal: principal, update-id: uint }
  {
    status: (string-ascii MAX-STATUS-LEN),
    timestamp: uint,
    updater: principal
  }
)

(define-map admins principal bool)

;; Variables
(define-data-var contract-paused bool false)
(define-data-var contract-admin principal tx-sender)
(define-data-var worker-counter uint u0)
(define-data-var status-update-counter { worker-principal: principal } uint)

;; Events
(define-private (emit-event (event-name (string-ascii 50)) (data (tuple)))
  (print { event: event-name, data: data }))

;; Read-only Functions
(define-read-only (get-worker-details (worker principal))
  (map-get? workers { worker-principal: worker }))

(define-read-only (is-worker-registered (worker principal))
  (is-some (get-worker-details worker)))

(define-read-only (is-worker-verified (worker principal))
  (match (get-worker-details worker)
    details (get verified details)
    false))

(define-read-only (is-worker-active (worker principal))
  (match (get-worker-details worker)
    details (get active details)
    false))

(define-read-only (get-worker-role (worker principal))
  (match (get-worker-details worker)
    details (get role details)
    none))

(define-read-only (get-status-history (worker principal) (update-id uint))
  (map-get? worker-status-history { worker-principal: worker, update-id: update-id }))

(define-read-only (get-status-update-count (worker principal))
  (default-to u0 (map-get? status-update-counter { worker-principal: worker })))

(define-read-only (is-admin (account principal))
  (default-to false (map-get? admins account)))

(define-read-only (is-paused)
  (var-get contract-paused))

(define-read-only (get-admin)
  (var-get contract-admin))

;; Private Validation Functions
(define-private (validate-string-length (str (string-utf8 uint)) (max-len uint))
  (and (> (len str) u0) (<= (len str) max-len)))

(define-private (validate-ascii-string-length (str (string-ascii uint)) (max-len uint))
  (and (> (len str) u0) (<= (len str) max-len)))

(define-private (validate-role (role (string-ascii MAX-ROLE-LEN)))
  (or 
    (is-eq role ROLE-WORKER)
    (is-eq role ROLE-SUPERVISOR)
    (is-eq role ROLE-ADMIN)))

(define-private (validate-skills (skills (list MAX-SKILLS (string-ascii MAX-SKILL-LEN))))
  (and
    (<= (len skills) MAX-SKILLS)
    (fold check-skill-length skills true)))

(define-private (check-skill-length (skill (string-ascii MAX-SKILL-LEN)) (acc bool))
  (and acc (validate-ascii-string-length skill MAX-SKILL-LEN)))

(define-private (validate-principal (p principal))
  (is-standard p))

;; Public Functions
(define-public (register-worker 
  (name (string-utf8 MAX-NAME-LEN)) 
  (description (string-utf8 MAX-DESCRIPTION-LEN))
  (role (string-ascii MAX-ROLE-LEN))
  (skills (list MAX-SKILLS (string-ascii MAX-SKILL-LEN))))
  (let ((worker tx-sender))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (validate-principal worker) ERR-INVALID-PRINCIPAL)
    (asserts! (not (is-worker-registered worker)) ERR-ALREADY-REGISTERED)
    (asserts! (validate-string-length name MAX-NAME-LEN) ERR-INVALID-INPUT)
    (asserts! (validate-string-length description MAX-DESCRIPTION-LEN) ERR-INVALID-INPUT)
    (asserts! (validate-ascii-string-length role MAX-ROLE-LEN) ERR-INVALID-INPUT)
    (asserts! (validate-role role) ERR-INVALID-ROLE)
    (asserts! (validate-skills skills) ERR-INVALID-INPUT)
    (map-set workers { worker-principal: worker }
      {
        name: name,
        description: description,
        role: role,
        skills: skills,
        registration-timestamp: stacks-block-height,
        last-update-timestamp: stacks-block-height,
        verified: false,
        active: true,
        verification-notes: none,
        employer: none
      })
    (var-set worker-counter (+ (var-get worker-counter) u1))
    (emit-event "worker-registered" { worker: worker, name: name, role: role })
    (ok true)))

(define-public (update-worker-profile
  (name (string-utf8 MAX-NAME-LEN)) 
  (description (string-utf8 MAX-DESCRIPTION-LEN))
  (skills (list MAX-SKILLS (string-ascii MAX-SKILL-LEN))))
  (let ((worker tx-sender)
        (details (unwrap! (get-worker-details worker) ERR-WORKER-NOT-FOUND)))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (get active details) ERR-INACTIVE-WORKER)
    (asserts! (validate-string-length name MAX-NAME-LEN) ERR-INVALID-INPUT)
    (asserts! (validate-string-length description MAX-DESCRIPTION-LEN) ERR-INVALID-INPUT)
    (asserts! (validate-skills skills) ERR-INVALID-INPUT)
    (map-set workers { worker-principal: worker }
      (merge details {
        name: name,
        description: description,
        skills: skills,
        last-update-timestamp: stacks-block-height
      }))
    (emit-event "worker-profile-updated" { worker: worker, name: name })
    (ok true)))

(define-public (verify-worker (worker principal) (notes (string-utf8 MAX-NOTES-LEN)))
  (let ((details (unwrap! (get-worker-details worker) ERR-WORKER-NOT-FOUND)))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (validate-principal worker) ERR-INVALID-PRINCIPAL)
    (asserts! (is-admin tx-sender) ERR-UNAUTHORIZED)
    (asserts! (not (get verified details)) ERR-ALREADY-VERIFIED)
    (asserts! (validate-string-length notes MAX-NOTES-LEN) ERR-MAX-LENGTH-EXCEEDED)
    (map-set workers { worker-principal: worker }
      (merge details {
        verified: true,
        verification-notes: (some notes),
        last-update-timestamp: stacks-block-height
      }))
    (emit-event "worker-verified" { worker: worker, verifier: tx-sender })
    (ok true)))

(define-public (assign-employer (worker principal) (employer principal))
  (let ((details (unwrap! (get-worker-details worker) ERR-WORKER-NOT-FOUND)))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (validate-principal worker) ERR-INVALID-PRINCIPAL)
    (asserts! (validate-principal employer) ERR-INVALID-PRINCIPAL)
    (asserts! (or (is-eq tx-sender worker) (is-admin tx-sender)) ERR-UNAUTHORIZED)
    (asserts! (get verified details) ERR-INACTIVE-WORKER)
    (map-set workers { worker-principal: worker }
      (merge details {
        employer: (some employer),
        last-update-timestamp: stacks-block-height
      }))
    (emit-event "employer-assigned" { worker: worker, employer: employer })
    (ok true)))

(define-public (deactivate-worker (worker principal))
  (let ((details (unwrap! (get-worker-details worker) ERR-WORKER-NOT-FOUND)))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (validate-principal worker) ERR-INVALID-PRINCIPAL)
    (asserts! (is-admin tx-sender) ERR-UNAUTHORIZED)
    (if (not (get active details))
      (ok false)
      (begin
        (map-set workers { worker-principal: worker }
          (merge details {
            active: false,
            last-update-timestamp: stacks-block-height
          }))
        (emit-event "worker-deactivated" { worker: worker, deactivator: tx-sender })
        (ok true)))))

(define-public (update-worker-status (worker principal) (status (string-ascii MAX-STATUS-LEN)))
  (let ((details (unwrap! (get-worker-details worker) ERR-WORKER-NOT-FOUND))
        (count (get-status-update-count worker)))
    (asserts! (not (var-get contract-paused)) ERR-PAUSED)
    (asserts! (validate-principal worker) ERR-INVALID-PRINCIPAL)
    (asserts! (or (is-eq tx-sender worker) (is-admin tx-sender)) ERR-UNAUTHORIZED)
    (asserts! (validate-ascii-string-length status MAX-STATUS-LEN) ERR-INVALID-STATUS)
    (map-set worker-status-history 
      { worker-principal: worker, update-id: (+ count u1) }
      {
        status: status,
        timestamp: stacks-block-height,
        updater: tx-sender
      })
    (map-set status-update-counter { worker-principal: worker } (+ count u1))
    (emit-event "status-updated" { worker: worker, status: status })
    (ok true)))

(define-public (add-admin (new-admin principal))
  (asserts! (not (var-get contract-paused)) ERR-PAUSED)
  (asserts! (validate-principal new-admin) ERR-INVALID-PRINCIPAL)
  (asserts! (is-eq tx-sender (var-get contract-admin)) ERR-UNAUTHORIZED)
  (map-set admins new-admin true)
  (emit-event "admin-added" { new-admin: new-admin })
  (ok true))

(define-public (remove-admin (admin principal))
  (asserts! (not (var-get contract-paused)) ERR-PAUSED)
  (asserts! (validate-principal admin) ERR-INVALID-PRINCIPAL)
  (asserts! (is-eq tx-sender (var-get contract-admin)) ERR-UNAUTHORIZED)
  (map-delete admins admin)
  (emit-event "admin-removed" { admin: admin })
  (ok true))

(define-public (pause-contract)
  (asserts! (is-admin tx-sender) ERR-UNAUTHORIZED)
  (var-set contract-paused true)
  (emit-event "contract-paused" {})
  (ok true))

(define-public (unpause-contract)
  (asserts! (is-admin tx-sender) ERR-UNAUTHORIZED)
  (var-set contract-paused false)
  (emit-event "contract-unpaused" {})
  (ok true))

(define-public (transfer-admin (new-admin principal))
  (asserts! (validate-principal new-admin) ERR-INVALID-PRINCIPAL)
  (asserts! (is-eq tx-sender (var-get contract-admin)) ERR-UNAUTHORIZED)
  (var-set contract-admin new-admin)
  (emit-event "admin-transferred" { new-admin: new-admin })
  (ok true))

;; Initialization
(map-set admins tx-sender true)