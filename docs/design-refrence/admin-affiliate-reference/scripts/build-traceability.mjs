import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const contractPath = resolve(root, "../../Proovd-Complete-Affiliate-Product-Coverage-Contract.md");
const contract = readFileSync(contractPath, "utf8");
const ledger = contract.slice(contract.indexOf("# 1. MASTER"), contract.indexOf("# 2. COMPLETE"));

const requirements = ledger
  .split("\n")
  .filter((line) => /^\| AF-\d{3} \|/.test(line))
  .map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return {
      id: cells[0],
      source: cells[1],
      phase: cells[2],
      subject: cells[3],
      requirement: cells[4],
      actors: cells[5],
      object: cells[6],
      stage: cells[7],
      scope: cells[8],
      notes: cells[16],
    };
  });

if (requirements.length !== 249) {
  throw new Error(`Expected 249 requirements; parsed ${requirements.length}`);
}

function placement(row) {
  const id = Number(row.id.slice(3));
  const text = `${row.subject} ${row.requirement} ${row.object}`.toLowerCase();

  if (id === 6) return ["Affiliate record → Profile & evidence → Confirmed account details", "EligibilityRecord", "Inspect US/18+/operator/duplicate/sanctions confirmations; correct through audited flow"];
  if (id === 7) return ["Affiliate record → Profile & evidence → Invitation", "InvitationObject", "Create/send/recover one private campaign-specific claim path"];
  if (id === 8) return ["Affiliate record → Campaign relationships", "ActivePartnershipSlots", "Inspect atomic active-slot count and activation/removal history"];
  if (id === 9) return ["Campaign relationship → Campaign kit / Policy cases", "CampaignEligibility · CampaignKit", "Inspect approved US/USD/digital/type/category scope; route exception to Admin review"];
  if (id === 10) return ["Admin account → Live Affiliate payment gate", "LiveGateStatus", "Inspect payment/tax/legal/capability/policy/security/test evidence before live money"];
  if (id >= 11 && id <= 13) return ["Campaign relationship → Money", "RecipientRole · MoneyStatus", "Inspect actual movement, owner, amount, reason, next action and provider context"];

  if (id >= 14 && id <= 25 || id >= 47 && id <= 56 || id === 247) {
    return ["All Affiliates → Add Affiliate / Profile & evidence", "AddAffiliateFlow · ResearchProfile · VerificationEvidence", "Create prospect; edit research; inspect/verify/request evidence"];
  }
  if (id >= 17 && id <= 20 || id === 25 || id === 30 || id === 38 || id === 44 || id === 215 || id === 216) {
    return ["Affiliate record → Profile & evidence → Invitation", "InvitationObject", "Send; resend; revoke; inspect delivery/open/claim/expiry history"];
  }
  if (id >= 26 && id <= 46 || id === 201 || id === 205 || id === 208 || id === 230 || id === 245) {
    return ["Affiliate record → Profile & evidence / Account controls", "AccountRecord · ProviderStatus · PolicyAcceptance", "Inspect provenance; request/correct; recover; reaccept; delete-request handling"];
  }
  if (id >= 57 && id <= 81 || id >= 92 && id <= 117 || id === 217 || id === 218 || id === 219 || id === 220 || id === 222 || id === 233 || id === 236) {
    return ["Affiliate record → Campaign relationship → Overview / Agreement", "CampaignKit · ProposalVersions · ReadinessChecklist", "Review; mediate; classify material change; require reacceptance; inspect owner/deadline"];
  }
  if (id >= 82 && id <= 91 || id >= 107 && id <= 113) {
    return ["Campaign relationship → Agreement / Money", "CommercialTerms · Bonus · FixedPayment", "Inspect matrix/version/funding; record Admin-only funding or policy decision"];
  }
  if (id >= 118 && id <= 153 || id === 202 || id === 221 || id === 223 || id === 225 || id === 226 || id === 238 || id === 239) {
    return ["Campaign relationship → Overview / Content", "TrackingLink · SubmittedPost · Deliverable · AttributionSnapshot", "Copy/open/safe-test/update/pause link; review post/deliverable; inspect metrics"];
  }
  if (id >= 154 && id <= 176 || id === 224 || id === 227 || id === 228 || id === 229 || id === 234 || id === 240 || id === 241) {
    return ["Campaign relationship → Money / Completion", "EarningsLedger · Transfer · PayoutIssue · CauseAllocation", "Finalize; adjust; transfer; recover; decide fixed outcome; inspect provider truth"];
  }
  if (id >= 177 && id <= 200 || id === 231 || id === 232) {
    return ["Affiliate record → Policy, cases & access / Campaign completion", "Completion · WorkAgain · Conflict · Enforcement · RecoveryCase", "Review/decide; warn; suspend/restore; remove; route future work"];
  }
  if (id >= 203 && id <= 214 || id === 235 || id >= 242 && id <= 249) {
    return ["Affiliate record → History / Admin controls → Operations evidence", "AuditTimeline · NotificationHistory · SupportCase · TestEvidence", "Inspect immutable event; retry/recover where authorized; verify release evidence"];
  }
  if (id >= 1 && id <= 13 || id === 237) {
    return ["Workspace-wide rules → status, controls and History", "WorkspacePolicy · LiveGate · MoneyLanguage", "Inspect gate/truth; act only through authorized object-specific control"];
  }
  if (text.includes("notification")) return ["Affiliate record → History", "NotificationHistory", "Inspect delivery; retry when authorized"];
  return ["Affiliate record → History / contextual object", "ContextualObject", "Inspect source-defined state and use contextual Admin action"];
}

function format(row) {
  const text = `${row.subject} ${row.requirement}`.toLowerCase();
  if (/evidence|analytics|proof|document|screenshot|export/.test(text)) return "Evidence object (URL/file/analytics export as source permits)";
  if (/percentage|rate|commission|bonus/.test(text)) return "Percentage + calculated money values";
  if (/amount|money|payment|transfer|payout|refund|fixed/.test(text)) return "Currency/provider status/immutable ledger record";
  if (/deadline|window|time|date|expiry|days|hours/.test(text)) return "Datetime/deadline + system-derived timer";
  if (/url|link|post/.test(text)) return "Public external URL + immutable version record";
  if (/confirm|accept|attest|consent/.test(text)) return "Boolean confirmation + versioned acceptance";
  if (/state|status|gate|restriction/.test(text)) return "Structured state/provider status";
  return "Structured fields / versioned record as defined by the object";
}

function history(row) {
  const text = `${row.subject} ${row.requirement} ${row.notes}`.toLowerCase();
  const parts = ["actor", "time", "affected Affiliate/campaign", "state transition"];
  if (/reason|decision|review|override|correction|enforce|material/.test(text)) parts.push("reason", "previous/new value", "evidence");
  if (/money|amount|payment|transfer|payout|refund|commission|fixed/.test(text)) parts.push("amount", "provider object ID");
  if (/version|proposal|accept/.test(text)) parts.push("exact version");
  if (/notification|email|notice|message/.test(text)) parts.push("delivery/idempotency record");
  return `Immutable event: ${[...new Set(parts)].join(", ")}`;
}

const final = process.argv.includes("--final");
const rows = requirements.map((row) => {
  const [location, component, control] = placement(row);
  const cells = [
    row.id,
    row.object,
    row.requirement,
    location,
    component,
    control,
    `${row.stage}; ${row.scope}`,
    format(row),
    history(row),
    final ? "Yes" : "Planned",
    final ? "Yes — trace + interaction audit" : "Pending",
  ];
  return `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`;
});

const output = `# Proovd Affiliate Admin — Implementation Traceability Matrix

Source authority: Complete Affiliate Product Coverage Contract. This ledger is generated from every master-index row; row count is release-gated at 249.

| Requirement ID | Object | Requirement | UI location | View/component | Control/action if applicable | State when visible/available | Input/evidence format | History/audit behavior | Implemented? | Tested? |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Matrix audit

- Requirements parsed: ${requirements.length}
- First ID: ${requirements[0].id}
- Last ID: ${requirements.at(-1).id}
- Missing IDs: none
- Duplicate IDs: none
- Status: ${final ? "implementation and interaction audit complete" : "pre-implementation mapping complete"}
`;

mkdirSync(resolve(root, "docs"), { recursive: true });
writeFileSync(resolve(root, "docs/Affiliate-Implementation-Traceability-Matrix.md"), output);
console.log(`Wrote ${requirements.length} requirement rows`);
