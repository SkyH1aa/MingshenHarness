import type { AgentQuestion, AgentQuestionAnswer, QuestionAnswer, QuestionRequest } from "./domain";

export const MAX_QUESTIONS = 3;
export const MAX_QUESTION_OPTIONS = 4;
export const MAX_QUESTION_ANSWER_LENGTH = 12000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Question data must be an object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`${name} must contain 1 to ${max} characters.`);
  return value.trim();
}

export function normalizeQuestions(args: Record<string, unknown>): AgentQuestion[] {
  const values = args.questions === undefined ? [args] : args.questions;
  if (!Array.isArray(values) || !values.length || values.length > MAX_QUESTIONS)
    throw new Error(`ask_user requires 1 to ${MAX_QUESTIONS} questions.`);
  const ids = new Set<string>();
  return values.map((value, index) => {
    const item = object(value);
    const id = item.id === undefined ? `question_${index + 1}` : text(item.id, "Question id", 80);
    if (ids.has(id)) throw new Error("Question ids must be unique.");
    ids.add(id);
    const options = item.options ?? [];
    if (!Array.isArray(options) || options.length > MAX_QUESTION_OPTIONS)
      throw new Error(`Each question supports at most ${MAX_QUESTION_OPTIONS} options plus Other.`);
    const labels = new Set<string>();
    const normalizedOptions = options.map((entry) => {
      const option = object(entry);
      const label = text(option.label, "Option label", 120);
      const key = label.toLocaleLowerCase("en-US");
      if (labels.has(key)) throw new Error("Option labels must be unique.");
      if (/^(other|其他|其它)(\s*[（(].*[）)])?$/i.test(label))
        throw new Error(
          "Do not include Other: the application adds a free-text option automatically.",
        );
      labels.add(key);
      return { label, description: text(option.description, "Option description", 1000) };
    });
    const multiple = item.multi_select ?? item.multiSelect ?? false;
    if (typeof multiple !== "boolean") throw new Error("multi_select must be a boolean.");
    return {
      id,
      header:
        item.header == null || item.header === "" ? "" : text(item.header, "Question header", 80),
      question: text(item.question, "Question", 2000),
      options: normalizedOptions,
      multiSelect: multiple,
    };
  });
}

export function requestQuestions(request: QuestionRequest): AgentQuestion[] {
  return request.questions?.length
    ? request.questions
    : [
        {
          id: "question_1",
          header: request.header,
          question: request.question,
          options: request.options,
          multiSelect: request.multiSelect ?? false,
        },
      ];
}

export function normalizeQuestionAnswer(
  request: QuestionRequest,
  input: QuestionAnswer,
): QuestionAnswer {
  const questions = requestQuestions(request);
  let values: unknown = input.answers;
  if (values === undefined) {
    if (questions.length !== 1) throw new Error("Answer every question using structured answers.");
    const question = questions[0] as AgentQuestion;
    const answer = text(input.answer, "Answer", MAX_QUESTION_ANSWER_LENGTH);
    values = [
      {
        id: question.id,
        selectedOptions: question.options.some((option) => option.label === answer) ? [answer] : [],
        otherText: question.options.some((option) => option.label === answer) ? null : answer,
      },
    ];
  }
  if (!Array.isArray(values) || values.length !== questions.length)
    throw new Error("Answer every question before submitting.");
  const seen = new Set<string>();
  const answers: AgentQuestionAnswer[] = values.map((value) => {
    const item = object(value);
    const question = questions.find((entry) => entry.id === item.id);
    if (!question || seen.has(question.id)) throw new Error("Unknown or duplicate question id.");
    seen.add(question.id);
    const selected = item.selectedOptions;
    if (
      !Array.isArray(selected) ||
      selected.length > MAX_QUESTION_OPTIONS ||
      selected.some(
        (label) =>
          typeof label !== "string" || !question.options.some((option) => option.label === label),
      )
    )
      throw new Error("The selected option does not belong to this question.");
    if (new Set(selected).size !== selected.length) throw new Error("Duplicate selected options.");
    const otherText =
      item.otherText == null || item.otherText === ""
        ? null
        : text(item.otherText, "Other answer", MAX_QUESTION_ANSWER_LENGTH);
    if (!selected.length && !otherText)
      throw new Error("Select an option or enter an Other answer.");
    if (!question.multiSelect && selected.length + (otherText ? 1 : 0) > 1)
      throw new Error("This question accepts only one answer.");
    return {
      id: question.id,
      selectedOptions: question.options
        .filter((option) => selected.includes(option.label))
        .map((option) => option.label),
      otherText,
    };
  });
  const ordered = questions.map(
    (question) => answers.find((answer) => answer.id === question.id) as AgentQuestionAnswer,
  );
  return {
    questionId: request.id,
    answers: ordered,
    answer: ordered
      .map(
        (answer, index) =>
          `${questions.length > 1 ? `${questions[index]?.question}\n` : ""}${[...answer.selectedOptions, answer.otherText].filter(Boolean).join("\n")}`,
      )
      .join("\n\n"),
  };
}
