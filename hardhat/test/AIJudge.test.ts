import { describe, it } from "node:test";
import assert from "node:assert";
import { network } from "hardhat";
import { keccak256, encodePacked, zeroAddress } from "viem";

describe("AIJudge Commit-Reveal Flow", () => {
  async function deployFixture() {
    const connection = await network.create();
    const viem = connection.viem;
    const aiJudge = await viem.deployContract("AIJudge");
    const [owner, participant1, participant2] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    return { aiJudge, owner, participant1, participant2, publicClient };
  }

  it("should create a bounty and allow submissions in the correct phases", async () => {
    const { aiJudge, owner, participant1, publicClient } = await deployFixture();

    // 1. Create a bounty with a deadline of block timestamp + 100 seconds
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const deadline = latestBlock.timestamp + 100n;
    
    const title = "Simple ML Rubric";
    const rubric = "Must be correct";
    const reward = 1000000000000000000n; // 1 ETH

    const hash = await aiJudge.write.createBounty([title, rubric, deadline], {
      value: reward,
      account: owner.account,
    });

    const bountyId = 1n;
    const bounty = await aiJudge.read.getBounty([bountyId]);
    assert.equal(bounty[0].toLowerCase(), owner.account.address.toLowerCase());
    assert.equal(bounty[1], title);
    assert.equal(bounty[3], reward);
    assert.equal(bounty[4], deadline);

    // 2. Submit a commitment before the deadline
    const answer = "My hidden answer";
    const salt = keccak256(encodePacked(["string"], ["my-secret-salt"]));
    const commitment = keccak256(
      encodePacked(
        ["string", "bytes32", "address", "uint256"],
        [answer, salt, participant1.account.address, bountyId]
      )
    );

    await aiJudge.write.submitCommitment([bountyId, commitment], {
      account: participant1.account,
    });

    const storedCommitment = await aiJudge.read.commitments([bountyId, participant1.account.address]);
    assert.equal(storedCommitment, commitment);

    // 3. Try to reveal before the deadline - should fail
    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, salt], {
        account: participant1.account,
      }),
      /reveal phase not started/
    );

    // 4. Advance time past the deadline
    await publicClient.transport.request({
      method: "evm_increaseTime",
      params: [120],
    });
    await publicClient.transport.request({
      method: "evm_mine",
    });

    // 5. Try to submit commitment after deadline - should fail
    await assert.rejects(
      aiJudge.write.submitCommitment([bountyId, commitment], {
        account: participant1.account,
      }),
      /submissions closed/
    );

    // 6. Reveal answer with incorrect salt - should fail
    const wrongSalt = keccak256(encodePacked(["string"], ["wrong-salt"]));
    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, wrongSalt], {
        account: participant1.account,
      }),
      /commitment mismatch/
    );

    // 7. Reveal answer with correct salt - should succeed
    await aiJudge.write.revealAnswer([bountyId, answer, salt], {
      account: participant1.account,
    });

    // Stored commitment should be cleared
    const clearedCommitment = await aiJudge.read.commitments([bountyId, participant1.account.address]);
    assert.equal(clearedCommitment, "0x0000000000000000000000000000000000000000000000000000000000000000");

    // Submission should be recorded
    const submissionCount = (await aiJudge.read.getBounty([bountyId]))[7];
    assert.equal(submissionCount, 1n);

    const submission = await aiJudge.read.getSubmission([bountyId, 0n]);
    assert.equal(submission[0].toLowerCase(), participant1.account.address.toLowerCase());
    assert.equal(submission[1], answer);

    // 8. Try to reveal again - should fail
    await assert.rejects(
      aiJudge.write.revealAnswer([bountyId, answer, salt], {
        account: participant1.account,
      }),
      /no commitment found/
    );
  });
});
