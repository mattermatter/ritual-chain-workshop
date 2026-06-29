"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canSubmit, canReveal, type Bounty } from "@/lib/bounty";
import { useWriteTx } from "@/hooks/useWriteTx";
import { keccak256, encodePacked } from "viem";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

export function SubmitAnswer({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { isConnected, address } = useAccount();
  const now = useNow();
  const [answer, setAnswer] = useState("");
  const [salt, setSalt] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCommitmentSaved, setShowCommitmentSaved] = useState(false);

  // Initialize unique salt for this session (commit phase)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const generatedSalt =
        "0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      setSalt(generatedSalt);
    }
  }, [bountyId, address]);

  // Read active commitment from contract to see if user has committed
  const { data: commitmentOnChain, refetch: refetchCommitment } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "commitments",
    args: [bountyId, address || "0x0000000000000000000000000000000000000000"],
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress && !!address },
  });

  const hasCommitment =
    commitmentOnChain &&
    commitmentOnChain !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Load saved commitment details from localStorage when reveal phase starts
  useEffect(() => {
    if (address && bountyId !== undefined && typeof window !== "undefined") {
      const saved = localStorage.getItem(`bounty_commit_${bountyId}_${address.toLowerCase()}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.answer && parsed.salt) {
            setAnswer(parsed.answer);
            setSalt(parsed.salt);
          }
        } catch (e) {
          console.error("Error parsing saved commitment:", e);
        }
      }
    }
  }, [bountyId, address, hasCommitment]);

  const txSubmit = useWriteTx(() => {
    // Save to local storage on successful commit tx signature
    if (address) {
      localStorage.setItem(
        `bounty_commit_${bountyId}_${address.toLowerCase()}`,
        JSON.stringify({ answer, salt })
      );
    }
    setShowCommitmentSaved(true);
    refetchCommitment();
    onSubmitted();
  });

  const txReveal = useWriteTx(() => {
    // Clean up local storage on successful reveal
    if (address) {
      localStorage.removeItem(`bounty_commit_${bountyId}_${address.toLowerCase()}`);
    }
    setAnswer("");
    setSalt("");
    refetchCommitment();
    onSubmitted();
  });

  const isCommitActive = canSubmit(bounty, now / 1000);
  const isRevealActive = canReveal(bounty, now / 1000);

  if (!isCommitActive && !isRevealActive) return null;

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !salt || !address || !contractAddress) return;

    try {
      // Compute commitment off-chain
      const commitment = keccak256(
        encodePacked(
          ["string", "bytes32", "address", "uint256"],
          [answer.trim(), salt as `0x${string}`, address, bountyId]
        )
      );

      await txSubmit.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !salt || !address || !contractAddress) return;

    try {
      await txReveal.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answer.trim(), salt as `0x${string}`],
        chainId: ritualChain.id,
      });
    } catch (err) {
      console.error(err);
    }
  }

  const handleCopyDetails = () => {
    const text = `Bounty ID: ${bountyId}\nAnswer: ${answer}\nSalt: ${salt}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Commit Phase (Before Deadline)
  if (isCommitActive) {
    return (
      <Card>
        <CardHeader
          title="Submit Commitment"
          subtitle="Phase 1: Your answer stays hidden. Submit commitment hash before the deadline."
        />
        <CardBody>
          <form onSubmit={handleCommit} className="space-y-4">
            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={4}
                placeholder="Write your submission…"
                disabled={txSubmit.isBusy || showCommitmentSaved}
              />
            </Field>

            <Field label="Submission Salt (Auto-generated)">
              <div className="flex gap-2">
                <Input value={salt} readOnly className="font-mono text-xs select-all text-zinc-400 bg-zinc-950" />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCopyDetails}
                  disabled={!answer.trim()}
                >
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </Field>

            <Button
              type="submit"
              disabled={!isConnected || !answer.trim() || !salt || txSubmit.isBusy || showCommitmentSaved}
              className="w-full"
            >
              {txSubmit.isBusy ? "Submitting Commitment…" : "Submit Commitment"}
            </Button>

            {showCommitmentSaved && (
              <Notice tone="green">
                🎉 Commitment submitted and saved to browser storage! Make sure to return after the deadline to reveal your answer.
              </Notice>
            )}

            {!isConnected && <p className="text-xs text-zinc-500">Connect your wallet to submit.</p>}

            <TxStatus
              state={txSubmit.state}
              error={txSubmit.error}
              hash={txSubmit.hash}
              explorerBase={explorerBase}
            />
          </form>
        </CardBody>
      </Card>
    );
  }

  // 2. Reveal Phase (After Deadline)
  if (isRevealActive) {
    if (!hasCommitment) {
      return (
        <Card>
          <CardHeader title="Reveal Submission" subtitle="Phase 2: Reveal answers for judging." />
          <CardBody>
            <Notice tone="zinc">
              No active commitment found for this wallet. If you submitted a commitment, make sure you are connected with the correct account. If you already revealed, your answer is listed under submissions.
            </Notice>
          </CardBody>
        </Card>
      );
    }

    const isPrefilled =
      answer &&
      salt &&
      typeof window !== "undefined" &&
      localStorage.getItem(`bounty_commit_${bountyId}_${address?.toLowerCase()}`) !== null;

    return (
      <Card>
        <CardHeader
          title="Reveal Submission"
          subtitle="Phase 2: Reveal your answer so the AI Judge can evaluate it."
        />
        <CardBody>
          <form onSubmit={handleReveal} className="space-y-4">
            {isPrefilled ? (
              <Notice tone="indigo">
                ⚡ Found saved commitment details in your browser! We pre-populated the fields for you.
              </Notice>
            ) : (
              <Notice tone="amber">
                ⚠️ No saved commitment found in this browser. Please paste your answer and salt exactly as they were when you committed.
              </Notice>
            )}

            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={4}
                placeholder="Paste your original answer…"
                disabled={txReveal.isBusy}
              />
            </Field>

            <Field label="Your Salt">
              <Input
                value={salt}
                onChange={(e) => setSalt(e.target.value)}
                placeholder="0x..."
                className="font-mono text-xs"
                disabled={txReveal.isBusy}
              />
            </Field>

            <Button
              type="submit"
              disabled={!isConnected || !answer.trim() || !salt || txReveal.isBusy}
              className="w-full bg-emerald-600 hover:bg-emerald-500"
            >
              {txReveal.isBusy ? "Revealing Answer…" : "Reveal Answer"}
            </Button>

            <TxStatus
              state={txReveal.state}
              error={txReveal.error}
              hash={txReveal.hash}
              explorerBase={explorerBase}
            />
          </form>
        </CardBody>
      </Card>
    );
  }

  return null;
}
