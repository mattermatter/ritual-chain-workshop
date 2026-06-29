# Privacy-Preserving AI Bounty Judge

This repository contains the secured **AI Bounty Judge** system. The submission process has been updated to use a **Commit-Reveal** flow, protecting participant submissions from being copied by others prior to the submission deadline.

---

## 1. Commit-Reveal Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Participant
    actor Owner
    participant Contract as AIJudge Smart Contract
    participant Browser as Local Storage

    Note over Participant, Contract: Commit Phase (Before Deadline)
    Participant->>Browser: Write Answer
    Note over Browser: Generate random 32-byte salt<br/>Store {answer, salt} in LocalStorage
    Participant->>Contract: submitCommitment(bountyId, commitmentHash)
    Note over Contract: Stores commitment mapping

    Note over Participant, Contract: Reveal Phase (After Deadline)
    Participant->>Browser: Retrieve {answer, salt}
    Participant->>Contract: revealAnswer(bountyId, answer, salt)
    Note over Contract: Verifies hash & sender<br/>Deletes commitment mapping<br/>Saves plaintext submission

    Note over Owner, Contract: Judging Phase (After Reveal)
    Owner->>Contract: judgeAll(bountyId, llmInput)
    Contract->>Contract: Execute LLM Precompile
    Owner->>Contract: finalizeWinner(bountyId, winnerIndex)
```

### Flow Breakdown
1. **Bounty Creation**: The owner initializes the bounty with a rubric, reward, and deadline.
2. **Commit Phase (Before Deadline)**:
   - Participants write their answers. 
   - A unique 32-byte `salt` is generated automatically.
   - The frontend computes the commitment hash: `keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))`.
   - The plaintext answer and salt are saved in the participant's `localStorage` to allow seamless auto-prefill during reveal.
   - The participant calls `submitCommitment(...)`. The contract saves the hash and prevents anyone from seeing the answer.
3. **Reveal Phase (After Deadline)**:
   - Once the deadline passes, submissions are closed.
   - Participants call `revealAnswer(...)` using their answer and salt.
   - The contract verifies that the hash matches the stored commitment.
   - The commitment is deleted to prevent double reveals, and the plaintext answer is added to `submissions` for AI evaluation.
4. **Judging**: The owner calls `judgeAll(...)` to send the revealed answers to the Ritual LLM precompile.
5. **Finalization**: The owner reviews the AI recommendation and finalizes the winner.

---

## 2. Architecture Note

### Required Track: Commit-Reveal Bounty
* **Plaintext Location**: Before the deadline, plaintext answers exist **only** on the client side (stored in the participant's browser `localStorage`). After the deadline, plaintext answers are revealed on-chain in `bounty.submissions` for evaluation.
* **On-Chain vs. Off-Chain Storage**:
  - **On-chain**: Commitment hashes (`bytes32`), bounty configurations (metadata, rubrics, rules), and revealed submissions (after deadline).
  - **Off-chain**: Plaintext answers and salts during the submission phase (browser-side only).
* **LLM Input**: When `judgeAll` is called, the revealed plaintext submissions are read from the contract, batched, formatted into a prompt array, and sent to the Ritual precompile.

### Advanced Track: Ritual-Native Hidden Submissions
For an end-to-end confidential solution utilizing Ritual's TEE-backed execution:
1. **Plaintext Location**: Plaintext answers exist **only** in the participant's secure client environment and inside the TEE (Trusted Execution Environment) node during the execution of the batch judging. They are never stored in plaintext on the public ledger or public off-chain databases.
2. **On-Chain vs. Off-Chain Storage**:
  - **On-chain**: Encrypted submissions (`bytes` payload) encrypted with the TEE public key (obtained via `DKMS_PRECOMPILE`), along with the bounty rubric and metadata.
  - **Off-chain (within TEE)**: The TEE private key decrypts the answers inside the secure enclave.
3. **Ritual TEE Batch Judging Flow**:
  - Each participant encrypts their submission using the TEE's public key.
  - The encrypted submissions are posted on-chain during the submission phase.
  - After the deadline, the judge requests inference. The LLM runs inside a Ritual TEE-backed executor.
  - The TEE retrieves the encrypted answers, decrypts them inside the enclave, formats the batch prompt, runs the LLM locally on the decrypted inputs, and outputs only the final judge results (`winnerIndex` and audit report) to the smart contract.

---

## 3. Test Plan for Reveal Cases

A TypeScript test suite is implemented in [AIJudge.test.ts](file:///Users/matter/academy-ritual/hardhat/test/AIJudge.test.ts).

### Test Cases Covered:
1. **Bounty Setup**: Verified correct deployment and initialization of bounty attributes.
2. **Pre-deadline Commitments**: Verified that participants can submit commitment hashes successfully prior to the deadline.
3. **Prevention of Early Reveals**: Reverts if `revealAnswer` is called before the deadline.
4. **Prevention of Late Commitments**: Reverts if `submitCommitment` is called after the deadline.
5. **Validation of Salt & Submissions**:
   - Reverts if an incorrect salt is supplied during reveal.
   - Successfully reveals the answer when correct details are provided.
6. **Prevention of Double Reveals**: Ensures that once a submission is revealed, its commitment is cleared, and calling `revealAnswer` again reverts.

---

## 4. Reflection Question

> **Question**: "What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?"

In a bounty system, the bounty specifications, rubrics, reward size, deadlines, and the final winner selection must be completely public to maintain system integrity, transparency, and trust among participants. Conversely, participant submissions and identities must stay hidden during the submission phase to prevent front-running, plagiarism, and bias. Submissions should only be revealed after the deadline, or kept permanently private using TEEs if they contain proprietary intellectual property. For the division of labor, the AI should be utilized to perform initial filtering, quantitative grading, consistency checks, and provide structured advisory rankings to accelerate review. The human, however, must retain final decision-making authority over selecting the winner, distributing the prize funds, and handling appeals, ensuring accountability and handling edge cases that the AI cannot judge.
