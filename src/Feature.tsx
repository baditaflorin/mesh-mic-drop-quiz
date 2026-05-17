import { useEffect, useMemo, useState } from "react";
import {
  Leaderboard,
  createClockSync,
  useDeadline,
  useDraft,
  useEventLog,
  useFairRng,
  useMeshSlot,
  useNamedPeer,
  usePhase,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type Quiz = { q: string; options: string[]; answerIdx: number };
type Answer = { peerId: string; hostId: string; choice: number; ts: number };
type Draft = { q: string; options: string[]; answerIdx: number };

const SLOT_MS = 30_000;
const L = ["A", "B", "C", "D"];
const EMPTY: Draft = { q: "", options: ["", "", "", ""], answerIdx: 0 };

export function Feature({ room, config }: Props) {
  if (!room)
    return (
      <div className="quiz-screen">
        <h1>mic drop quiz</h1>
        <p>Connecting…</p>
      </div>
    );
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const { name, setName, nameOf, myName } = useNamedPeer(config, room);
  const clock = useMemo(() => createClockSync(room.provider), [room]);
  useEffect(() => () => clock.destroy(), [clock]);
  const slot = useMeshSlot(clock, SLOT_MS);
  const phase = usePhase<"writing" | "hosting" | "done">(room, "phase", "writing");
  const rng = useFairRng(room, "quiz-salts");
  const answers = useEventLog<Answer>(room, "answers");
  const draft = useDraft<Draft>(`${config.storagePrefix}:draft`, EMPTY);
  const [, rerender] = useState(0);

  useEffect(() => {
    const cb = () => rerender((n) => n + 1);
    const maps = ["quizzes", "scores", "state"].map((k) => room.doc.getMap(k));
    maps.forEach((m) => m.observe(cb));
    return () => maps.forEach((m) => m.unobserve(cb));
  }, [room]);

  const quizzes = room.doc.getMap<Quiz>("quizzes");
  const scores = room.doc.getMap<number>("scores");
  const state = room.doc.getMap<number>("state");
  const submitted = !!quizzes.get(room.peerId);

  const submitQuiz = () => {
    const v = draft.value;
    if (!v.q.trim() || v.options.some((o) => !o.trim())) return;
    void draft.commit((c) => {
      quizzes.set(room.peerId, {
        q: c.q.trim(),
        options: c.options.map((o) => o.trim()),
        answerIdx: c.answerIdx,
      });
    });
  };
  const startHosting = () => {
    if (quizzes.size < 1) return;
    room.doc.transact(() => {
      state.set("baselineSlot", slot.slotId);
      phase.transition("hosting", { from: "writing" });
    });
  };

  const order = useMemo(
    () => rng.shuffle(Array.from(quizzes.keys()).sort()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rng.seed, quizzes.size, phase.phase],
  );
  const baseline = (state.get("baselineSlot") as number | undefined) ?? slot.slotId;
  const hIdx = order.length
    ? (((slot.slotId - baseline) % order.length) + order.length) % order.length
    : 0;
  const hostId = order[hIdx] ?? "";
  const currentQuiz = hostId ? quizzes.get(hostId) : undefined;
  const hostName = hostId ? (nameOf(hostId) ?? `peer-${hostId.slice(0, 6)}`) : "";
  const roundAnswers = answers.events.filter(
    (a) => a.hostId === hostId && Math.floor(a.ts / SLOT_MS) === slot.slotId,
  );
  const myAns = roundAnswers.find((a) => a.peerId === room.peerId);
  const guessers = Math.max(0, room.peerCount);
  const deadline = useDeadline(slot.slotStart + SLOT_MS, { clock });
  const revealed = (guessers > 0 && roundAnswers.length >= guessers) || deadline.isPast;
  const isHost = hostId === room.peerId;

  const choose = (idx: number) => {
    if (isHost || myAns || !currentQuiz) return;
    answers.push({ peerId: room.peerId, hostId, choice: idx, ts: clock.meshNow() });
    if (idx === currentQuiz.answerIdx) scores.set(room.peerId, (scores.get(room.peerId) ?? 0) + 1);
  };

  const items = Array.from(quizzes.keys())
    .map((pid) => ({
      id: pid,
      name: nameOf(pid) ?? `peer-${pid.slice(0, 6)}`,
      score: (scores.get(pid) ?? 0) as number,
    }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="quiz-screen">
      <header className="quiz-header">
        <h1>mic drop quiz</h1>
        <p className="quiz-sub">
          {room.peerCount + 1} peer{room.peerCount === 0 ? "" : "s"} · {quizzes.size} quizzes ·{" "}
          {phase.phase}
        </p>
      </header>
      <input
        className="quiz-name"
        placeholder="your name"
        aria-label="your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={32}
      />

      {phase.phase === "writing" && (
        <div className="quiz-write">
          {submitted ? (
            <p className="quiz-chip">you're in — {myName}</p>
          ) : (
            <>
              <textarea
                className="quiz-q"
                placeholder="your question"
                value={draft.value.q}
                onChange={(e) => draft.setValue({ ...draft.value, q: e.target.value })}
                rows={2}
              />
              {[0, 1, 2, 3].map((i) => (
                <div className="quiz-opt-row" key={i}>
                  <input
                    type="radio"
                    name="answer"
                    value={i}
                    checked={draft.value.answerIdx === i}
                    onChange={() => draft.setValue({ ...draft.value, answerIdx: i })}
                    aria-label={`mark ${L[i]} correct`}
                  />
                  <input
                    className="quiz-opt"
                    placeholder={`option ${L[i]}`}
                    value={draft.value.options[i]}
                    onChange={(e) => {
                      const opts = draft.value.options.slice();
                      opts[i] = e.target.value;
                      draft.setValue({ ...draft.value, options: opts });
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="quiz-submit"
                aria-label="submit my quiz"
                onClick={submitQuiz}
              >
                submit my quiz
              </button>
            </>
          )}
          <button
            type="button"
            className="quiz-start"
            aria-label="start hosting"
            onClick={startHosting}
            disabled={quizzes.size < 1}
          >
            start hosting ({quizzes.size})
          </button>
        </div>
      )}

      {phase.phase === "hosting" && currentQuiz && (
        <div className="quiz-stage">
          <p className="quiz-host">
            hosting: <span className="quiz-host-name">{hostName}</span>
          </p>
          <h2 className="quiz-q-text">{currentQuiz.q}</h2>
          <div className="quiz-answers">
            {currentQuiz.options.map((opt, i) => {
              const correct = revealed && i === currentQuiz.answerIdx;
              const mine = myAns?.choice === i;
              return (
                <button
                  key={i}
                  type="button"
                  className={`quiz-answer ${correct ? "is-correct" : ""} ${mine ? "is-mine" : ""}`}
                  data-idx={i}
                  aria-label={`answer ${L[i]}`}
                  onClick={() => choose(i)}
                  disabled={isHost || !!myAns || revealed}
                >
                  <span className="quiz-letter">{L[i]}</span> {opt}
                  {correct && <span className="quiz-chip-correct"> correct</span>}
                </button>
              );
            })}
          </div>
          <div className="quiz-bar" aria-hidden="true">
            <div className="quiz-bar-fill" style={{ opacity: 0.3 + slot.progress * 0.7 }}>
              {Math.ceil(deadline.remainingMs / 1000)}s
            </div>
          </div>
          <p className="quiz-answer-count">
            answers: {roundAnswers.length} / {Math.max(1, guessers)}
          </p>
          <Leaderboard items={items} highlightId={room.peerId} title="scores" />
        </div>
      )}
    </div>
  );
}
