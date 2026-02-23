export type IssueTemplateType = "Epic" | "Feature" | "Subfeature";

export interface IssueCreateTemplatePayload {
  type?: string;
  parentLinks?: string;
  baseBranch?: string;
  plannedBranch?: string;
  branchReason?: string;
  problemStatement?: string;
  scopeIn?: string;
  scopeOut?: string;
  definitionOfDone?: string;
  dependencies?: string;
  risks?: string;
  validationPlan?: string;
  acceptanceCriteria?: string;
  architectureImpact?: string;
  rolloutStrategy?: string;
  taskChecklist?: string;
  successMetrics?: string;
  suspectedCause?: string;
  investigationNotes?: string;
}

export interface IssueCreateBoardFieldsPayload {
  status?: string;
  workMode?: string;
  priority?: string;
  size?: string;
  area?: string;
}

export interface NormalizedIssueCreateTemplate {
  type: IssueTemplateType;
  parentLinks: string;
  baseBranch: string;
  plannedBranch: string;
  branchReason: string;
  problemStatement: string;
  scopeIn: string;
  scopeOut: string;
  definitionOfDone: string;
  dependencies: string;
  risks: string;
  validationPlan: string;
  acceptanceCriteria: string;
  architectureImpact: string;
  rolloutStrategy: string;
  taskChecklist: string;
  successMetrics: string;
  suspectedCause: string;
  investigationNotes: string;
}

export interface NormalizedIssueBoardFields {
  status: string;
  workMode: string;
  priority: string;
  size: string;
  area: string;
}

function normalizeIssueType(value: unknown): IssueTemplateType {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "epic") {
    return "Epic";
  }
  if (normalized === "feature") {
    return "Feature";
  }
  return "Subfeature";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugifyText(value: string, fallback: string, maxLength = 48): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  return slug || fallback;
}

export function suggestPlannedBranch(issueType: IssueTemplateType, repo: string, title: string): string {
  const repoName = repo.includes("/") ? repo.split("/")[1] ?? "" : repo;
  const area = slugifyText(repoName || "area", "area", 18);
  const slugSource = title.trim() || "short-slug";
  const shortSlug = slugifyText(slugSource, "short-slug", 36);
  if (issueType === "Epic") {
    return `epic/${shortSlug}`;
  }
  if (issueType === "Feature") {
    return `feat/${area}-${shortSlug}`;
  }
  return `subfeat/${area}-${shortSlug}`;
}

export function sanitizeIssueTemplatePayload(
  raw: unknown,
  repo: string,
  title: string
): NormalizedIssueCreateTemplate {
  const source = raw && typeof raw === "object" ? (raw as IssueCreateTemplatePayload) : {};
  const type = normalizeIssueType(source.type);
  const plannedBranch = normalizeText(source.plannedBranch) || suggestPlannedBranch(type, repo, title);
  return {
    type,
    parentLinks: normalizeText(source.parentLinks),
    baseBranch: normalizeText(source.baseBranch) || "main",
    plannedBranch,
    branchReason: normalizeText(source.branchReason),
    problemStatement: normalizeText(source.problemStatement),
    scopeIn: normalizeText(source.scopeIn),
    scopeOut: normalizeText(source.scopeOut),
    definitionOfDone: normalizeText(source.definitionOfDone),
    dependencies: normalizeText(source.dependencies),
    risks: normalizeText(source.risks),
    validationPlan: normalizeText(source.validationPlan),
    acceptanceCriteria: normalizeText(source.acceptanceCriteria),
    architectureImpact: normalizeText(source.architectureImpact),
    rolloutStrategy: normalizeText(source.rolloutStrategy),
    taskChecklist: normalizeText(source.taskChecklist),
    successMetrics: normalizeText(source.successMetrics),
    suspectedCause: normalizeText(source.suspectedCause),
    investigationNotes: normalizeText(source.investigationNotes)
  };
}

export function sanitizeIssueBoardFields(raw: unknown): NormalizedIssueBoardFields {
  const source = raw && typeof raw === "object" ? (raw as IssueCreateBoardFieldsPayload) : {};
  return {
    status: normalizeText(source.status),
    workMode: normalizeText(source.workMode),
    priority: normalizeText(source.priority),
    size: normalizeText(source.size),
    area: normalizeText(source.area)
  };
}

export function buildIssueTemplateBody(
  repo: string,
  template: NormalizedIssueCreateTemplate,
  additionalNotes: string
): string {
  const safe = (value: string): string => (value.trim().length > 0 ? value.trim() : "(none)");
  const sections: string[] = [];
  sections.push("## Intake");
  sections.push(`- Type: ${template.type}`);
  sections.push(`- Repository: ${safe(repo)}`);
  sections.push(`- Parent links: ${safe(template.parentLinks)}`);
  sections.push(`- Base branch: ${safe(template.baseBranch)}`);
  sections.push(`- Planned branch name: ${safe(template.plannedBranch)}`);
  sections.push(`- Branch convention reason: ${safe(template.branchReason)}`);
  sections.push("");
  sections.push("## Problem Statement");
  sections.push(safe(template.problemStatement));
  sections.push("");
  sections.push("## Scope");
  sections.push("### In Scope");
  sections.push(safe(template.scopeIn));
  sections.push("");
  sections.push("### Out of Scope");
  sections.push(safe(template.scopeOut));
  sections.push("");
  sections.push("## Definition of Done");
  sections.push(safe(template.definitionOfDone));
  sections.push("");
  sections.push("## Dependencies");
  sections.push(safe(template.dependencies));
  sections.push("");
  sections.push("## Risks");
  sections.push(safe(template.risks));
  sections.push("");
  sections.push("## Validation Plan");
  sections.push(safe(template.validationPlan));
  sections.push("");

  if (template.type === "Epic") {
    sections.push("## Epic-Specific");
    sections.push(`- Success metrics + milestone window: ${safe(template.successMetrics)}`);
    sections.push(`- Cross-repo / architecture impact: ${safe(template.architectureImpact)}`);
    sections.push("");
  } else if (template.type === "Feature") {
    sections.push("## Feature-Specific");
    sections.push("### Acceptance Criteria");
    sections.push(safe(template.acceptanceCriteria));
    sections.push("");
    sections.push("### Architecture Impact");
    sections.push(safe(template.architectureImpact));
    sections.push("");
    sections.push("### Rollout Strategy");
    sections.push(safe(template.rolloutStrategy));
    sections.push("");
  } else {
    sections.push("## Subfeature-Specific");
    sections.push("### Technical Requirements");
    sections.push(safe(template.acceptanceCriteria));
    sections.push("");
    sections.push("### Module / File Impact");
    sections.push(safe(template.architectureImpact));
    sections.push("");
    sections.push("### PR Strategy");
    sections.push(safe(template.rolloutStrategy));
    sections.push("");
    sections.push("### Task Checklist");
    sections.push(safe(template.taskChecklist));
    sections.push("");
  }

  sections.push("## Investigation");
  sections.push(`- Suspected cause: ${safe(template.suspectedCause)}`);
  sections.push(`- Investigation notes: ${safe(template.investigationNotes)}`);

  const trimmedAdditional = additionalNotes.trim();
  if (trimmedAdditional.length > 0) {
    sections.push("");
    sections.push("## Additional Notes");
    sections.push(trimmedAdditional);
  }

  return sections.join("\n").trim();
}
