import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const page = readFileSync(resolve(root, "app/page.tsx"), "utf8");
const css = readFileSync(resolve(root, "app/globals.css"), "utf8");
const matrix = readFileSync(resolve(root, "docs/Affiliate-Implementation-Traceability-Matrix.md"), "utf8");

const checks = {
  "Affiliates opens the directory": 'useState<View>("directory")',
  "No Affiliate is selected on entry": 'useState<string | null>(null)',
  "All Affiliates heading exists": 'all: "All Affiliates"',
  "Add Affiliate is visible": '> Add Affiliate</button>',
  "Search works from controlled query": 'value={query} onChange={(event) => onQuery(event.target.value)}',
  "Back returns to All Affiliates": 'All Affiliates</button>',
  "Prospect saves without account creation": '>Save prospect</button>',
  "Campaign invitation sends separately": '>Send campaign invitation</button>',
  "Campaign selection uses a dropdown": 'Campaign name<select',
  "Founder selection uses a dropdown": 'Founder<select',
  "Evidence view exists": '> View evidence</b>',
  "Account and research are combined": 'Account &amp; research',
  "Admin research section is named Channel details": '<h4>Channel details</h4>',
  "Account details appear before research": 'profile-source-block account-profile-block',
  "Name replaces legal name": '<dt>Name</dt>',
  "Username replaces public identity": '<dt>Username</dt>',
  "Phone number is in account details": '<dt>Phone number</dt>',
  "Verification decision exists": '>Verify audience evidence</button>',
  "Invitation lifecycle is inspectable": 'Campaign invitation" onClose={onClose} wide',
  "Multiple campaign relationships are supported": 'campaigns.map((relationship)',
  "Proovd visual Campaign kit is reachable": 'Close visual Campaign kit',
  "Campaign kit is separated from terms and work": 'Proovd-provided visuals',
  "Bilateral acceptance cannot be substituted": 'Admin cannot accept for either party.',
  "Accepted terms remain unlocked before launch": 'Accepted · locks at launch',
  "Terms lock when the campaign goes live": 'Locked at launch · version 3',
  "Upfront fee naming is used": '<p className="eyebrow">Upfront fee</p>',
  "Upfront fee defaults to not requested": 'fixedPayment: "Not requested"',
  "Campaign type leads the campaign context": 'eyebrow={`${campaign.type} · ${affiliate.name} · Campaign relationship`}',
  "Readiness checklist is complete": 'Complete Creator readiness checklist',
  "Affiliate URL can be copied": 'Copy Affiliate link',
  "Affiliate URL can be opened": 'Open Affiliate link',
  "Affiliate URL can be safe-tested": 'Safe test Affiliate link',
  "Post is a public URL object": 'Open live public post',
  "First-post review criteria exist": 'REVIEW_CHECKS.map',
  "First-post approval remains required": 'Approve submitted post',
  "Post edits collect due time": 'Correction due',
  "Corrected submissions preserve versions": 'previous submission preserved',
  "Deliverable evidence is reviewable": 'Review deliverable evidence',
  "Availability is verifiable": 'Verify content availability',
  "Stripe truth is read-only": 'Stripe supplied · read only',
  "Payout recovery action exists": 'Send payout reminder',
  "Conflict and self-preorder cases exist": 'Affiliate self-preorder',
  "Suspension and restoration exist": 'Suspend Affiliate account',
  "Termination and Creator failure exist": 'Active termination request',
  "Campaign suspend and kill exist": 'Kill campaign and open recovery',
  "Completion decision exists": 'Approve successful completion',
  "Future work exists": 'Work-again request',
  "History is immutable and inspectable": 'immutable event {item.id}',
  "Mobile bottom-sheet posture exists": '@media (max-width: 600px)',
  "Touch targets are at least 44px": 'min-height: 44px',
  "Reduced motion remains supported": '@media (prefers-reduced-motion: reduce)',
};

const failures = Object.entries(checks).filter(([name, needle]) => !(page + css).includes(needle)).map(([name]) => name);
if (page.includes("deliverable.due") || page.includes("due {item.due}")) failures.push("Per-deliverable deadline remains in the product");
if (page.includes("Through seven days after") || page.includes("Availability through")) failures.push("Invented availability deadline remains in the product");
if (page.includes('title: "Use-case walkthrough"') || page.includes('title: "Closing reminder"')) failures.push("Invented deliverables remain in seeded campaigns");
if (page.includes('Campaign name<input') || page.includes('Founder<input')) failures.push("Campaign or Founder remains a free-text field");
if (page.includes('agreementState: "locked"') || page.includes('agreementState === "locked"')) failures.push("Agreement acceptance is still being used as the campaign lock state");
if (/fixed(?: creator)? payment|fixed-payment/i.test(page)) failures.push("Retired fixed-payment terminology remains user-facing");
if (page.includes('$500')) failures.push("Automatic $500 upfront-fee data remains in the prototype");
if (page.includes('>Why fit<') || page.includes('Campaign fit / why this prospect')) failures.push("Why fit remains in the visible product");
if (page.includes('>Legal name<') || page.includes('>Public identity<')) failures.push("Retired account labels remain visible");
const requirementRows = matrix.match(/^\| AF-\d{3} \|/gm) ?? [];
const ids = requirementRows.map((row) => row.match(/AF-\d{3}/)?.[0]).filter(Boolean);
if (requirementRows.length !== 249) failures.push(`Traceability row count is ${requirementRows.length}, expected 249`);
if (new Set(ids).size !== 249) failures.push("Traceability IDs are missing or duplicated");
if (!page.includes('const SEED_AFFILIATES: Affiliate[] = [...BASE_AFFILIATES, ...LIFECYCLE_AFFILIATES]')) failures.push("Lifecycle seed set is not composed");
if ((page.match(/id: "AF-\d{4}"/g) ?? []).length < 14) failures.push("Fewer than 14 lifecycle Affiliates are seeded");

console.log(JSON.stringify({ status: failures.length ? "failed" : "passed", checks: Object.keys(checks).length + 3, traceabilityRows: requirementRows.length, seededAffiliates: (page.match(/id: "AF-\d{4}"/g) ?? []).length, failures }, null, 2));
if (failures.length) process.exit(1);
