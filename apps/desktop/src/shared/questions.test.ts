import { describe, expect, it } from "vitest";
import type { QuestionRequest } from "./domain";
import { normalizeQuestionAnswer, normalizeQuestions } from "./questions";

const option = (label: string) => ({ label, description: `${label} description.` });
const item = {
  id: "format",
  header: "Format",
  question: "Which formats?",
  multi_select: false,
  options: [option("Markdown"), option("Word")],
};
const request = (multi = false): QuestionRequest => ({
  id: "request",
  sessionId: "s",
  runId: "r",
  header: "Format",
  question: item.question,
  options: item.options,
  questions: normalizeQuestions({ questions: [{ ...item, multi_select: multi }] }),
  createdAt: "",
});

describe("Agent questions", () => {
  it("supports structured and legacy requests without inventing defaults or Other", () => {
    expect(normalizeQuestions({ questions: [item] })).toEqual([
      {
        id: "format",
        header: "Format",
        question: item.question,
        multiSelect: false,
        options: item.options,
      },
    ]);
    expect(normalizeQuestions({ question: "Explain?", options: [] })[0]).toMatchObject({
      id: "question_1",
      multiSelect: false,
      options: [],
    });
    expect(
      normalizeQuestions({ questions: [{ ...item, multi_select: true }] })[0]?.multiSelect,
    ).toBe(true);
  });
  it("enforces question and option limits, descriptions, unique identifiers and app-provided Other", () => {
    for (const invalid of [
      { questions: [] },
      { questions: Array.from({ length: 4 }, (_, n) => ({ ...item, id: String(n) })) },
      { questions: [item, item] },
      { questions: [{ ...item, options: Array.from({ length: 5 }, (_, n) => option(String(n))) }] },
      { questions: [{ ...item, options: [option("Duplicate"), option("duplicate")] }] },
      { questions: [{ ...item, options: [{ label: "Missing", description: " " }] }] },
      { questions: [{ ...item, options: [option("Other")] }] },
      { questions: [{ ...item, multi_select: "true" }] },
    ])
      expect(() => normalizeQuestions(invalid)).toThrow();
  });
  it("accepts single selections or custom Other, never both for single-select", () => {
    const req = request();
    expect(
      normalizeQuestionAnswer(req, {
        questionId: req.id,
        answers: [{ id: "format", selectedOptions: ["Word"], otherText: null }],
      }).answers?.[0],
    ).toMatchObject({ selectedOptions: ["Word"], otherText: null });
    expect(
      normalizeQuestionAnswer(req, { questionId: req.id, answer: "PDF" }).answers?.[0]?.otherText,
    ).toBe("PDF");
    expect(() =>
      normalizeQuestionAnswer(req, {
        questionId: req.id,
        answers: [{ id: "format", selectedOptions: ["Word"], otherText: "PDF" }],
      }),
    ).toThrow("one answer");
  });
  it("preserves multi selections and Other, normalizes order and rejects unknown or duplicate values", () => {
    const req = request(true);
    const result = normalizeQuestionAnswer(req, {
      questionId: req.id,
      answers: [{ id: "format", selectedOptions: ["Word", "Markdown"], otherText: "  PDF  " }],
    });
    expect(result.answers?.[0]).toEqual({
      id: "format",
      selectedOptions: ["Markdown", "Word"],
      otherText: "PDF",
    });
    for (const selectedOptions of [["unknown"], ["Word", "Word"]])
      expect(() =>
        normalizeQuestionAnswer(req, {
          questionId: req.id,
          answers: [{ id: "format", selectedOptions, otherText: null }],
        }),
      ).toThrow();
    expect(() =>
      normalizeQuestionAnswer(req, {
        questionId: req.id,
        answers: [{ id: "format", selectedOptions: [], otherText: " " }],
      }),
    ).toThrow();
  });
  it("requires all batch answers and maps them by stable id, not display order", () => {
    const req = request();
    req.questions = normalizeQuestions({
      questions: [item, { ...item, id: "audience", options: [] }],
    });
    expect(() => normalizeQuestionAnswer(req, { questionId: req.id, answer: "Word" })).toThrow(
      "every question",
    );
    const result = normalizeQuestionAnswer(req, {
      questionId: req.id,
      answers: [
        { id: "audience", selectedOptions: [], otherText: "Students" },
        { id: "format", selectedOptions: ["Word"], otherText: null },
      ],
    });
    expect(result.answers?.map((answer) => answer.id)).toEqual(["format", "audience"]);
    expect(() =>
      normalizeQuestionAnswer(req, {
        questionId: req.id,
        answers: (result.answers ?? []).map((answer) => ({ ...answer, id: "format" })),
      }),
    ).toThrow("duplicate");
  });
  it("keeps free text as inert text and limits its size", () => {
    const req = request();
    const payload = '<img src=x onerror="alert(1)">中文 & العربية';
    expect(
      normalizeQuestionAnswer(req, { questionId: req.id, answer: payload }).answers?.[0]?.otherText,
    ).toBe(payload);
    expect(() =>
      normalizeQuestionAnswer(req, { questionId: req.id, answer: "x".repeat(12001) }),
    ).toThrow();
  });
});
