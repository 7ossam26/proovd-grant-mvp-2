"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  History,
  Link2,
  LockKeyhole,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";

type View = "directory" | "affiliate" | "profile" | "campaign" | "review" | "controls" | "history";
type CampaignSection = "overview" | "agreement" | "content" | "money";
type DirectoryFilter = "all" | "admin" | "verification" | "payout";
type VerificationState = "verified" | "needs_evidence" | "under_review";
type InvitationState = "draft" | "delivery_failed" | "sent" | "delivered" | "opened" | "signup_started" | "claimed" | "revoked" | "expired";
type PostState = "not_submitted" | "submitted" | "edits_requested" | "approved" | "rejected" | "escalated";
type LinkState = "inactive" | "active" | "paused";
type CompletionState = "not_due" | "review_due" | "successful" | "disqualified";
type EvidenceKind = "image" | "document" | "generated";
type ResearchEvidenceCategory =
  | "Channel ownership / permission"
  | "Sponsored-content history"
  | "Promotion / traffic plan"
  | "Similar-campaign performance"
  | "General verification evidence";
type CaseKind = "conflict" | "self_preorder" | "termination" | "creator_failure" | "appeal" | "support" | "refund" | "payout_recovery" | "negative_balance" | "deletion";
type EventCategory = "account" | "campaign" | "evidence" | "money" | "policy";

type ModalType =
  | "recruit"
  | "admin_account"
  | "research"
  | "account_correction"
  | "profile_correction"
  | "evidence"
  | "upload_evidence"
  | "verify_evidence"
  | "request_evidence"
  | "invitation"
  | "assign_campaign"
  | "relationship_fields"
  | "campaign_kit"
  | "agreement_history"
  | "proposal_review"
  | "link_controls"
  | "post_history"
  | "post_resubmission"
  | "post_reject"
  | "post_escalate"
  | "deliverable_review"
  | "availability_review"
  | "payout_reminder"
  | "transfer"
  | "earnings_adjustment"
  | "fixed_decision"
  | "completion"
  | "work_again"
  | "record_case"
  | "review_case"
  | "warning"
  | "suspend"
  | "restore"
  | "remove"
  | "access_decision"
  | "policy_reacceptance"
  | "readiness"
  | "password_recovery"
  | "deletion_request"
  | "campaign_suspend"
  | "campaign_kill";

interface Attention {
  owner: "Admin" | "Affiliate" | "Founder" | "Stripe" | "System";
  label: string;
  detail: string;
  kind: "review" | "recovery" | "waiting" | "provider";
}

interface EvidenceAsset {
  id: string;
  name: string;
  kind: EvidenceKind;
  source: "Affiliate" | "Admin";
  uploadedAt: string;
  url?: string;
  category?: ResearchEvidenceCategory;
}

interface AuditEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  category: EventCategory;
  actor: string;
}

interface PostVersion {
  version: number;
  url: string;
  submittedAt: string;
  status: string;
}

interface Deliverable {
  id: string;
  title: string;
  state: "pending" | "submitted" | "verified" | "needs_evidence" | "waived";
  proofUrl?: string;
}

interface CampaignRelationship {
  id: string;
  name: string;
  founder: string;
  type: "Product Campaign" | "Idea Campaign";
  state: string;
  stateLabel: string;
  owner: Attention["owner"];
  designation: "Initial launch roster" | "Mid-campaign addition";
  activated: string;
  closes: string;
  kitVersion: number;
  kitAssets: string[];
  availabilityTerm: string;
  agreementState: "not_started" | "proposal_pending" | "accepted" | "expired";
  termsLocked: boolean;
  compensation: string;
  bonus: string;
  fixedPayment: string;
  trackingLink: string;
  linkState: LinkState;
  postState: PostState;
  postVersions: PostVersion[];
  deliverables: Deliverable[];
  availabilityVerified: boolean;
  earningsAmount: number;
  earningsStatus: "estimated" | "finalized" | "approved for transfer" | "transferred" | "paid out" | "payout failed" | "adjusted";
  completion: CompletionState;
  workAgain: "none" | "requested" | "accepted" | "declined";
}

interface SupportCase {
  id: string;
  kind: CaseKind;
  title: string;
  detail: string;
  status: "open" | "resolved";
  owner: string;
  due: string;
}

interface Affiliate {
  id: string;
  initials: string;
  name: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
  country?: string;
  state?: string;
  handle: string;
  channelUrl: string;
  platform: string;
  subtype: string;
  location: string;
  niche: string;
  tier: string;
  whyFit: string;
  adminBio: string;
  source: string;
  adminNotes: string;
  audienceSize: number;
  engagementRate: number;
  demographics: string;
  subtypeMetrics?: string;
  channelPermission?: string;
  sponsoredHistory?: string;
  promotionPlan?: string;
  similarCampaignPerformance?: string;
  conflicts?: string;
  redFlags?: string;
  actualOperatorConfirmed?: boolean;
  noDuplicateConfirmed?: boolean;
  sanctionsConfirmed?: boolean;
  termsVersion?: string;
  aupVersion?: string;
  notificationsDigest?: boolean;
  deletionState?: "none" | "requested" | "retention_review";
  verification: VerificationState;
  verificationDate?: string;
  providerState: "ready" | "needs_information" | "under_review";
  accountState: "eligible" | "suspended";
  policyState?: "current" | "reacceptance_required";
  proposalAccess: "standard" | "restricted";
  invitation: InvitationState;
  invitationSentAt?: string;
  invitationDeliveredAt?: string;
  invitationOpenedAt?: string;
  signupStartedAt?: string;
  claimedAt?: string;
  invitationExpiresAt?: string;
  invitationFailure?: string;
  attention?: Attention;
  evidence: EvidenceAsset[];
  campaigns: CampaignRelationship[];
  cases: SupportCase[];
  events: AuditEvent[];
}

interface ModalState {
  type: ModalType;
  evidenceId?: string;
  deliverableId?: string;
  caseId?: string;
}

const REVIEW_CHECKS = [
  { id: "account", label: "Approved account and channel" },
  { id: "public", label: "Publicly accessible" },
  { id: "disclosure", label: "FTC disclosure is hard to miss" },
  { id: "brand", label: "Approved brand guidance followed" },
  { id: "claims", label: "No prohibited or unsupported claims" },
  { id: "work", label: "Agreed work is present" },
  { id: "risk", label: "Material campaign risk disclosed when applicable" },
] as const;

type CheckId = (typeof REVIEW_CHECKS)[number]["id"];

const RESEARCH_PICTURE_FIELDS = [
  { key: "channelPermission", label: "Channel ownership / permission" },
  { key: "sponsoredHistory", label: "Sponsored-content history" },
  { key: "promotionPlan", label: "Promotion / traffic plan" },
  { key: "similarCampaignPerformance", label: "Similar-campaign performance" },
] as const;

type ResearchPictureKey = (typeof RESEARCH_PICTURE_FIELDS)[number]["key"];
type ResearchPictureFiles = Record<ResearchPictureKey, File[]>;

function emptyResearchPictures(): ResearchPictureFiles {
  return { channelPermission: [], sponsoredHistory: [], promotionPlan: [], similarCampaignPerformance: [] };
}

function evidenceFromFile(file: File, category: ResearchEvidenceCategory): EvidenceAsset {
  return {
    id: `EV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
    name: file.name,
    kind: file.type.startsWith("image/") ? "image" : "document",
    source: "Admin",
    uploadedAt: "Now · Aug 11, 2026",
    url: URL.createObjectURL(file),
    category,
  };
}

function evidenceFromResearchPictures(pictures: ResearchPictureFiles): EvidenceAsset[] {
  return RESEARCH_PICTURE_FIELDS.flatMap(({ key, label }) =>
    pictures[key].map((file) => evidenceFromFile(file, label)),
  );
}

const mayaPost = "https://www.instagram.com/p/C-teeb-founders/";
const CAMPAIGN_CHOICES = [
  { name: "Teeb Founding Launch", founder: "Teeb Labs LLC", type: "Product Campaign" },
  { name: "Pulseboard Launch", founder: "Pulseboard LLC", type: "Product Campaign" },
  { name: "Cedar Launch", founder: "Cedar Labs LLC", type: "Product Campaign" },
  { name: "Arcdesk Launch", founder: "Arcdesk Inc.", type: "Product Campaign" },
  { name: "Looplight Launch", founder: "Looplight Labs", type: "Product Campaign" },
  { name: "Forge Idea Campaign", founder: "Forge Studio LLC", type: "Idea Campaign" },
] as const;
const FOUNDER_CHOICES = Array.from(new Set(CAMPAIGN_CHOICES.map((campaignChoice) => campaignChoice.founder)));

function event(id: string, time: string, title: string, detail: string, category: EventCategory, actor = category === "money" ? "Admin / provider" : category === "account" ? "Affiliate / system" : "Jordan Lee / system"): AuditEvent {
  return { id, time, title, detail, category, actor };
}

function campaign(overrides: Partial<CampaignRelationship> & Pick<CampaignRelationship, "id" | "name" | "founder">): CampaignRelationship {
  const relationshipState = overrides.state ?? "active";
  const acceptedBeforeLaunch = ["accepted", "creator_prep", "active", "closed_reconciling", "closed_resolved", "suspended", "removed", "creator_replacement"].includes(relationshipState);
  const launched = ["active", "closed_reconciling", "closed_resolved", "suspended", "creator_replacement"].includes(relationshipState);
  return {
    id: overrides.id,
    name: overrides.name,
    founder: overrides.founder,
    type: "Product Campaign",
    state: relationshipState,
    stateLabel: "Active partnership",
    owner: "System",
    designation: "Initial launch roster",
    activated: "Aug 10 · 9:00 AM EDT",
    closes: "Aug 18 · 8:00 PM EDT",
    kitVersion: 6,
    kitAssets: ["Product hero image", "Product detail image", "Campaign social graphic"],
    availabilityTerm: "Agreed campaign availability period",
    agreementState: acceptedBeforeLaunch ? "accepted" : "not_started",
    termsLocked: launched,
    compensation: "30% of valid captured attributed pre-tax sales",
    bonus: "+5% after 25 captured attributed Backers",
    fixedPayment: "Not requested",
    trackingLink: "https://proovd.co/teeb?via=maya",
    linkState: "active",
    postState: "not_submitted",
    postVersions: [],
    deliverables: [
      { id: "launch", title: "Launch post", state: "pending" },
    ],
    availabilityVerified: false,
    earningsAmount: 0,
    earningsStatus: "estimated",
    completion: "not_due",
    workAgain: "none",
    ...overrides,
  };
}

const BASE_AFFILIATES: Affiliate[] = [
  {
    id: "AF-1048",
    initials: "MJ",
    name: "Maya Johnson",
    email: "maya@mayabuilds.co",
    handle: "@mayabuilds",
    channelUrl: "https://www.instagram.com/mayabuilds/",
    platform: "Instagram",
    subtype: "Social Creator",
    location: "Austin, Texas",
    niche: "Productivity & creator tools",
    tier: "Tier A",
    whyFit: "Maya teaches lightweight systems to first-time builders. Her audience already buys practical creator tools.",
    adminBio: "Practical creator-systems educator with a US-first audience of early-career builders.",
    source: "Founder referral · Jordan Lee",
    adminNotes: "Strong disclosure history. Prefers written campaign briefs.",
    audienceSize: 82412,
    engagementRate: 4.8,
    demographics: "71% United States · 64% ages 18–34",
    verification: "verified",
    verificationDate: "Jun 2, 2026",
    providerState: "ready",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "claimed",
    invitationSentAt: "May 27 · 2:40 PM",
    attention: { owner: "Admin", label: "First post submitted", detail: "Teeb Founding Launch · today, 10:44 AM", kind: "review" },
    evidence: [
      { id: "EV-301", name: "Instagram audience analytics · May 1–31", kind: "generated", source: "Affiliate", uploadedAt: "Jun 1 · 4 screenshots" },
      { id: "EV-302", name: "Audience demographics export.pdf", kind: "document", source: "Affiliate", uploadedAt: "Jun 1 · 3:12 PM", url: "data:text/plain,Proovd%20prototype%20evidence%20record" },
    ],
    campaigns: [
      campaign({
        id: "CP-TEEB",
        name: "Teeb Founding Launch",
        founder: "Teeb Labs LLC",
        owner: "Admin",
        postState: "submitted",
        postVersions: [{ version: 1, url: mayaPost, submittedAt: "Today · 10:44 AM", status: "Submitted" }],
        deliverables: [
          { id: "launch", title: "Launch post", state: "submitted", proofUrl: mayaPost },
        ],
        earningsAmount: 286,
      }),
      campaign({
        id: "CP-THREAD",
        name: "Threadwise Beta",
        founder: "Threadwise Inc.",
        state: "closed_resolved",
        stateLabel: "Successfully completed",
        owner: "System",
        activated: "Apr 3 · 9:00 AM EDT",
        closes: "May 2 · 8:00 PM EDT",
        kitVersion: 4,
        compensation: "18% of valid captured attributed pre-tax sales",
        bonus: "No Creator-specific bonus",
        fixedPayment: "Not requested",
        trackingLink: "https://proovd.co/threadwise?via=maya",
        linkState: "inactive",
        postState: "approved",
        postVersions: [{ version: 1, url: "https://www.instagram.com/p/threadwise-maya/", submittedAt: "Apr 4 · 9:18 AM", status: "Passed" }],
        deliverables: [{ id: "thread-post", title: "Launch post", state: "verified", proofUrl: "https://www.instagram.com/p/threadwise-maya/" }],
        availabilityVerified: true,
        earningsAmount: 1482.2,
        earningsStatus: "paid out",
        completion: "successful",
        workAgain: "requested",
      }),
    ],
    cases: [],
    events: [
      event("E1", "Today · 10:44 AM", "First post submitted", "Maya supplied a public Instagram URL · version 1", "campaign"),
      event("E2", "Aug 10 · 9:00 AM", "Campaign went live · terms locked", "Agreement version 3 locked at launch · system activated the Affiliate link", "campaign"),
      event("E3", "Aug 9 · 4:32 PM", "Creator readiness cleared", "Jordan Lee verified every applicable readiness item", "campaign"),
      event("E4", "Aug 8 · 2:16 PM", "Agreement version 3 accepted", "Maya and Teeb Labs accepted the exact same version · terms lock when the campaign goes live", "campaign"),
      event("E6", "Jun 2 · 3:18 PM", "Audience evidence verified", "Instagram analytics · 4 screenshots · May 1–31", "evidence"),
      event("E7", "May 28 · 11:07 AM", "Affiliate account claimed", "Maya confirmed her account details and policy versions", "account"),
      event("E8", "May 27 · 2:40 PM", "Campaign invitation sent", "Jordan Lee · Teeb Founding Launch · token version 1", "account"),
    ],
  },
  {
    id: "AF-1072",
    initials: "JE",
    name: "Jordan Ellis",
    email: "jordan@buildbrief.com",
    handle: "@buildbrief",
    channelUrl: "https://www.youtube.com/@buildbrief",
    platform: "YouTube",
    subtype: "Social Creator",
    location: "Brooklyn, New York",
    niche: "Early-stage product reviews",
    tier: "Tier A",
    whyFit: "Long-form product demos with an audience of first-time SaaS buyers.",
    adminBio: "YouTube reviewer focused on small software products and founder workflows.",
    source: "Admin research · YouTube",
    adminNotes: "High conversion on tutorial-led offers.",
    audienceSize: 44500,
    engagementRate: 5.6,
    demographics: "76% United States · 58% ages 24–34",
    verification: "verified",
    verificationDate: "Jul 18, 2026",
    providerState: "needs_information",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "claimed",
    invitationSentAt: "Jul 10 · 9:20 AM",
    attention: { owner: "Stripe", label: "Bank information required", detail: "Payout failed · Jordan must update Stripe", kind: "provider" },
    evidence: [{ id: "EV-401", name: "YouTube Studio audience export.pdf", kind: "document", source: "Affiliate", uploadedAt: "Jul 17 · 2:12 PM", url: "data:text/plain,YouTube%20Studio%20export" }],
    campaigns: [campaign({ id: "CP-PULSE", name: "Pulseboard Launch", founder: "Pulseboard LLC", state: "closed_reconciling", stateLabel: "Payout follow-up", owner: "Stripe", trackingLink: "https://proovd.co/pulseboard?via=buildbrief", linkState: "inactive", postState: "approved", postVersions: [{ version: 1, url: "https://www.youtube.com/watch?v=pulseboard-review", submittedAt: "Jul 22 · 3:18 PM", status: "Passed" }], deliverables: [{ id: "video", title: "Product walkthrough", state: "verified", proofUrl: "https://www.youtube.com/watch?v=pulseboard-review" }], availabilityVerified: true, earningsAmount: 932.5, earningsStatus: "payout failed", completion: "successful" })],
    cases: [],
    events: [event("J1", "Today · 8:12 AM", "Payout failed", "Stripe requires updated bank information · no Admin edit is available", "money")],
  },
  {
    id: "AF-1086",
    initials: "AC",
    name: "Alex Chen",
    email: "alex@campusstack.org",
    handle: "@campusstack",
    channelUrl: "https://www.tiktok.com/@campusstack",
    platform: "TikTok",
    subtype: "Student Affiliate",
    location: "Boston, Massachusetts",
    niche: "Student productivity",
    tier: "Tier B",
    whyFit: "Direct access to US college students through an owned TikTok account.",
    adminBio: "Student creator covering study systems and campus software.",
    source: "Campus ambassador referral",
    adminNotes: "School endorsement language must remain prohibited.",
    audienceSize: 18700,
    engagementRate: 0,
    demographics: "Audience geography evidence incomplete",
    verification: "needs_evidence",
    providerState: "ready",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "claimed",
    attention: { owner: "Admin", label: "Audience evidence ready for review", detail: "TikTok analytics · uploaded yesterday", kind: "review" },
    evidence: [{ id: "EV-501", name: "TikTok follower analytics.png", kind: "generated", source: "Affiliate", uploadedAt: "Yesterday · 6:40 PM" }],
    campaigns: [campaign({ id: "CP-NOTE", name: "Noteflow Founding Offer", founder: "Noteflow, Inc.", state: "creator_prep", stateLabel: "Readiness blocked", owner: "Admin", trackingLink: "https://proovd.co/noteflow?via=campusstack", linkState: "inactive", postState: "not_submitted", earningsAmount: 0 })],
    cases: [],
    events: [event("A1", "Yesterday · 6:40 PM", "Audience evidence uploaded", "TikTok follower analytics · Admin decision required", "evidence")],
  },
  {
    id: "AF-1094",
    initials: "PS",
    name: "Priya Shah",
    email: "priya@tinyteams.news",
    handle: "@tinyteams",
    channelUrl: "https://tinyteams.news",
    platform: "Newsletter",
    subtype: "Newsletter Operator",
    location: "Chicago, Illinois",
    niche: "Small-team operations",
    tier: "Tier A",
    whyFit: "Permission-based newsletter for small software teams.",
    adminBio: "Newsletter operator writing about practical systems for teams under ten people.",
    source: "Admin research · newsletter directory",
    adminNotes: "CAN-SPAM and list-permission evidence verified.",
    audienceSize: 12600,
    engagementRate: 41.2,
    demographics: "68% United States · audience is permission-based",
    verification: "verified",
    verificationDate: "Aug 1, 2026",
    providerState: "ready",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "claimed",
    attention: { owner: "Founder", label: "Proposal waiting on Founder", detail: "Revision 2 · response due tomorrow", kind: "waiting" },
    evidence: [{ id: "EV-601", name: "Newsletter analytics export.csv", kind: "document", source: "Affiliate", uploadedAt: "Jul 30 · 11:05 AM", url: "data:text/csv,subscribers,open_rate%0A12600,41.2" }],
    campaigns: [campaign({ id: "CP-KIT", name: "Kiteboard Teams Launch", founder: "Kiteboard Software LLC", state: "proposal_pending", stateLabel: "Proposal pending", owner: "Founder", agreementState: "proposal_pending", compensation: "Affiliate proposes 23%", bonus: "+4% after 30 captured attributed Backers", fixedPayment: "$350 requested · not accepted", trackingLink: "Not available before acceptance", linkState: "inactive", earningsAmount: 0 })],
    cases: [],
    events: [event("P1", "Yesterday · 4:22 PM", "Proposal revision 2 sent", "Priya proposed 23% + $350 upfront fee · Founder owns the response", "campaign")],
  },
  {
    id: "AF-1103",
    initials: "DM",
    name: "Devon Miles",
    email: "devon@productminute.fm",
    handle: "@productminute",
    channelUrl: "https://productminute.fm",
    platform: "Podcast",
    subtype: "Podcast Host",
    location: "Portland, Oregon",
    niche: "Consumer product discovery",
    tier: "Tier A",
    whyFit: "Owned podcast with high-intent early adopter listeners.",
    adminBio: "Short-form podcast host covering useful consumer software.",
    source: "Founder referral · Cedar Labs",
    adminNotes: "Audio disclosure included in pre-roll.",
    audienceSize: 9200,
    engagementRate: 63.4,
    demographics: "74% United States · 61% ages 25–44",
    verification: "verified",
    verificationDate: "Mar 4, 2026",
    providerState: "ready",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "claimed",
    attention: { owner: "Admin", label: "Completion decision ready", detail: "Cedar Launch · all work and money records resolved", kind: "review" },
    evidence: [{ id: "EV-701", name: "Podcast host dashboard.pdf", kind: "document", source: "Affiliate", uploadedAt: "Mar 3 · 10:00 AM", url: "data:text/plain,Podcast%20analytics" }],
    campaigns: [campaign({ id: "CP-CEDAR", name: "Cedar Launch", founder: "Cedar Labs LLC", state: "closed_reconciling", stateLabel: "Completion review", owner: "Admin", activated: "Jul 2 · 9:00 AM EDT", closes: "Jul 28 · 8:00 PM EDT", compensation: "22% of valid captured attributed pre-tax sales", bonus: "+3% achieved", fixedPayment: "$400 · eligible", trackingLink: "https://proovd.co/cedar?via=productminute", linkState: "inactive", postState: "approved", postVersions: [{ version: 1, url: "https://productminute.fm/episodes/cedar", submittedAt: "Jul 3 · 8:00 AM", status: "Passed" }], deliverables: [{ id: "episode", title: "Sponsored episode", state: "verified", proofUrl: "https://productminute.fm/episodes/cedar" }, { id: "close", title: "Close mention", state: "verified", proofUrl: "https://productminute.fm/episodes/cedar-close" }], availabilityVerified: true, earningsAmount: 1264.8, earningsStatus: "finalized", completion: "review_due" })],
    cases: [],
    events: [event("D1", "Today · 7:30 AM", "Completion review opened", "Every deliverable, availability, upfront-fee and earnings record is resolved", "campaign")],
  },
  {
    id: "AF-1117",
    initials: "SP",
    name: "Sienna Park",
    email: "sienna@makerstudy.com",
    handle: "@makerstudy",
    channelUrl: "https://www.instagram.com/makerstudy/",
    platform: "Instagram",
    subtype: "Social Creator",
    location: "San Diego, California",
    niche: "Maker education",
    tier: "Tier B",
    whyFit: "Research indicates strong fit with project-based learning offers.",
    adminBio: "Maker educator with a public project-based learning channel.",
    source: "Admin research · Instagram",
    adminNotes: "Prospect has not claimed the account.",
    audienceSize: 23100,
    engagementRate: 3.9,
    demographics: "US audience estimate · verification pending",
    verification: "under_review",
    providerState: "under_review",
    accountState: "eligible",
    proposalAccess: "standard",
    invitation: "delivery_failed",
    invitationSentAt: "Today · 8:05 AM",
    invitationFailure: "Email provider returned a hard bounce. Correct the recipient only after verifying the source, then resend the same invitation identity.",
    attention: { owner: "Admin", label: "Invitation delivery failed", detail: "Makerlab Pilot · email bounced", kind: "recovery" },
    evidence: [{ id: "EV-801", name: "Admin research capture · Instagram", kind: "generated", source: "Admin", uploadedAt: "Yesterday · 3:20 PM" }],
    campaigns: [campaign({ id: "CP-MAKER", name: "Makerlab Pilot", founder: "Makerlab Tools LLC", state: "invited", stateLabel: "Invitation sent", owner: "Affiliate", trackingLink: "Not available before activation", linkState: "inactive", postState: "not_submitted", earningsAmount: 0 })],
    cases: [],
    events: [event("S1", "Today · 8:06 AM", "Invitation delivery failed", "Email provider returned a hard bounce · invitation identity preserved", "account")],
  },
];

const LIFECYCLE_AFFILIATES: Affiliate[] = [
  {
    id: "AF-1128", initials: "NR", name: "Noor Rahman", email: "noor@foundercommons.co", phone: "+1 312 555 0198",
    handle: "@foundercommons", channelUrl: "https://foundercommons.co/community", platform: "Community", subtype: "Community Operator",
    location: "Illinois · public research", niche: "First-time founder communities", tier: "Tier B",
    whyFit: "Admin research shows an owned, moderated community with strong access to the campaign's US founder audience.",
    adminBio: "Community operator hosting practical sessions for first-time software founders.", source: "Admin research · community directory",
    adminNotes: "Prospect only. No Affiliate account exists.", audienceSize: 6400, engagementRate: 18.2,
    demographics: "72% United States · community owner report", subtypeMetrics: "4,180 monthly active members · 18.2% weekly participation",
    channelPermission: "Owner/admin access researched · written proof pending", sponsoredHistory: "Two prior sponsor posts researched",
    promotionPlan: "One permitted founder-resource post plus weekly digest placement", similarCampaignPerformance: "No Proovd campaign history",
    conflicts: "None discovered", redFlags: "Permission artifact still required", verification: "under_review", providerState: "under_review",
    accountState: "eligible", proposalAccess: "standard", invitation: "draft", evidence: [],
    campaigns: [campaign({ id: "CP-ORBIT", name: "Orbit Founding Launch", founder: "Orbit Works LLC", state: "prospect", stateLabel: "Prospect", owner: "Admin", designation: "Initial launch roster", trackingLink: "Not available before activation", linkState: "inactive" })],
    cases: [], events: [event("N1", "Aug 10 · 3:40 PM", "Campaign-specific prospect created", "Admin research · no user account created · permission evidence pending", "account")],
  },
  {
    id: "AF-1131", initials: "ET", name: "Elena Torres", email: "elena@shipnotes.dev", phone: "+1 305 555 0133",
    handle: "@shipnotes", channelUrl: "https://shipnotes.dev", platform: "Newsletter", subtype: "Newsletter Operator", location: "Miami, Florida",
    niche: "Indie software launches", tier: "Tier A", whyFit: "Permission-based US builder newsletter with consistent launch coverage.",
    adminBio: "Newsletter operator covering small software launches.", source: "Admin research · newsletter sponsor archive", adminNotes: "Signup started; no account claim yet.",
    audienceSize: 18400, engagementRate: 8.4, demographics: "69% United States", subtypeMetrics: "18,400 subscribers · 8.4% click-through",
    channelPermission: "Owner confirmed in public masthead", sponsoredHistory: "Public sponsor archive verified", promotionPlan: "Sponsor block and launch issue",
    similarCampaignPerformance: "Average sponsor CTR 7.9%", conflicts: "None disclosed", redFlags: "None", verification: "verified", verificationDate: "Aug 8, 2026",
    providerState: "under_review", accountState: "eligible", proposalAccess: "standard", invitation: "signup_started", invitationSentAt: "Aug 9 · 9:00 AM",
    invitationDeliveredAt: "Aug 9 · 9:01 AM", invitationOpenedAt: "Aug 9 · 11:42 AM", signupStartedAt: "Aug 10 · 2:18 PM", invitationExpiresAt: "Implementation decision · duration not source-prescribed",
    evidence: [{ id: "EV-931", name: "Newsletter sponsor archive", kind: "document", source: "Admin", uploadedAt: "Aug 8 · 1:12 PM", url: "data:text/plain,Newsletter%20sponsor%20archive" }],
    campaigns: [campaign({ id: "CP-QUILL", name: "Quill Launch", founder: "Quill Systems Inc.", state: "signup_started", stateLabel: "Signup started", owner: "Affiliate", trackingLink: "Not available before activation", linkState: "inactive" })], cases: [],
    events: [event("ET1", "Aug 10 · 2:18 PM", "Affiliate signup started", "Invitation version 1 · account not yet claimed", "account"), event("ET2", "Aug 9 · 11:42 AM", "Invitation opened", "Delivery provider open event recorded", "account")],
  },
  {
    id: "AF-1134", initials: "MR", name: "Marcus Reed", email: "marcus@tooltalk.fm", handle: "@tooltalkfm", channelUrl: "https://tooltalk.fm", platform: "Podcast", subtype: "Podcast Host", location: "Nashville, Tennessee",
    niche: "Founder tools", tier: "Tier A", whyFit: "High-intent founder-tool audience.", adminBio: "Weekly founder software podcast host.", source: "Founder referral", adminNotes: "Account claimed before Founder finished signup.",
    audienceSize: 11200, engagementRate: 71, demographics: "77% United States", subtypeMetrics: "8,900 median listens · 71% completion", channelPermission: "Host and feed owner verified", sponsoredHistory: "Five public pre-roll sponsors", promotionPlan: "Verbal pre-roll with named material relationship", similarCampaignPerformance: "Two completed Proovd campaigns", conflicts: "None", redFlags: "None",
    verification: "verified", verificationDate: "Jul 27, 2026", providerState: "ready", accountState: "eligible", proposalAccess: "standard", invitation: "claimed", invitationSentAt: "Aug 4 · 10:00 AM", invitationDeliveredAt: "Aug 4 · 10:01 AM", invitationOpenedAt: "Aug 4 · 10:18 AM", signupStartedAt: "Aug 4 · 10:21 AM", claimedAt: "Aug 4 · 10:33 AM",
    actualOperatorConfirmed: true, noDuplicateConfirmed: true, sanctionsConfirmed: true, termsVersion: "Terms v2026.07", aupVersion: "Affiliate AUP v2026.07",
    attention: { owner: "Founder", label: "Waiting for Founder", detail: "Toolset Preview · no Affiliate action needed", kind: "waiting" },
    evidence: [{ id: "EV-934", name: "Podcast dashboard export.pdf", kind: "document", source: "Affiliate", uploadedAt: "Jul 26 · 5:30 PM", url: "data:text/plain,Podcast%20dashboard" }],
    campaigns: [campaign({ id: "CP-TOOLSET", name: "Toolset Preview", founder: "Toolset Labs LLC", state: "signed_up_waiting_for_founder", stateLabel: "Waiting for Founder", owner: "Founder", trackingLink: "Not available before activation", linkState: "inactive" })], cases: [], events: [event("MR1", "Aug 4 · 10:33 AM", "Affiliate account claimed", "US/18+/operator/duplicate/sanctions confirmations · policy versions recorded", "account")],
  },
  {
    id: "AF-1138", initials: "TB", name: "Tessa Brooks", email: "tessa@buildcircle.community", handle: "@buildcircle", channelUrl: "https://buildcircle.community", platform: "Community", subtype: "Community Operator", location: "Denver, Colorado", niche: "No-code founders", tier: "Tier B",
    whyFit: "Owned founder community with explicit sponsor rules.", adminBio: "Community operator for US no-code founders.", source: "Admin research", adminNotes: "Founder claimed; listing payment not complete.", audienceSize: 3700, engagementRate: 22.6, demographics: "81% United States", subtypeMetrics: "2,100 monthly active users", channelPermission: "Owner permission verified", sponsoredHistory: "One partner AMA", promotionPlan: "Founder AMA and permitted resource post", similarCampaignPerformance: "No completed Proovd campaign", conflicts: "Advisor relationship disclosed and cleared", redFlags: "None",
    verification: "verified", verificationDate: "Aug 2, 2026", providerState: "needs_information", accountState: "eligible", proposalAccess: "standard", invitation: "claimed", claimedAt: "Aug 3 · 1:10 PM",
    attention: { owner: "Founder", label: "Preparing campaign", detail: "Buildcircle can review the kit; decisions and work are disabled", kind: "waiting" },
    evidence: [{ id: "EV-938", name: "Community permissions.pdf", kind: "document", source: "Affiliate", uploadedAt: "Aug 1 · 4:15 PM", url: "data:text/plain,Permission" }],
    campaigns: [campaign({ id: "CP-LUMA", name: "Luma Founding Campaign", founder: "Luma Craft LLC", state: "preparing", stateLabel: "Preparing · listing unpaid", owner: "Founder", trackingLink: "Not available before acceptance", linkState: "inactive" })], cases: [], events: [event("TB1", "Aug 3 · 3:00 PM", "Proovd visual Campaign kit available", "Review-only visual access granted once · no work permission", "campaign")],
  },
  {
    id: "AF-1142", initials: "OG", name: "Owen Gray", email: "owen@tinycourse.co", handle: "@tinycourse", channelUrl: "https://tinycourse.co", platform: "Course", subtype: "Course Instructor", location: "Seattle, Washington", niche: "Creator education", tier: "Tier A",
    whyFit: "Owned cohort course for the exact target audience.", adminBio: "Creator-course instructor.", source: "Admin sourcing plan", adminNotes: "Accepted; Stripe capability is the remaining blocker.", audienceSize: 5200, engagementRate: 92, demographics: "67% United States", subtypeMetrics: "1,220 enrolled students · 4.8/5 rating", channelPermission: "Instructor/admin access verified", sponsoredHistory: "No paid sponsor history", promotionPlan: "Course resource page and one cohort email", similarCampaignPerformance: "One successful Idea Campaign", conflicts: "None", redFlags: "None",
    verification: "verified", verificationDate: "Jul 12, 2026", providerState: "needs_information", accountState: "eligible", proposalAccess: "standard", invitation: "claimed", claimedAt: "Jul 13 · 9:42 AM",
    attention: { owner: "Affiliate", label: "Tracking activation blocked", detail: "Stripe needs Owen to finish payout setup", kind: "provider" },
    evidence: [{ id: "EV-942", name: "Course enrollment and ratings.pdf", kind: "document", source: "Affiliate", uploadedAt: "Jul 11 · 2:00 PM", url: "data:text/plain,Course%20evidence" }],
    campaigns: [campaign({ id: "CP-FORGE", name: "Forge Idea Campaign", founder: "Forge Studio LLC", type: "Idea Campaign", state: "accepted", stateLabel: "Accepted · readiness blocked", owner: "Affiliate", agreementState: "accepted", compensation: "30% of valid captured attributed pre-tax reward subtotal", bonus: "+4% after $8,000 attributed captured subtotal", fixedPayment: "Not available for Idea Campaigns", trackingLink: "https://proovd.co/forge?via=tinycourse", linkState: "inactive" })], cases: [], events: [event("OG1", "Aug 7 · 10:03 AM", "Standard terms accepted", "30% Idea compensation · IP/disclosure/Terms exact versions accepted · terms lock when the campaign goes live · inactive link created", "campaign")],
  },
  {
    id: "AF-1146", initials: "LP", name: "Lina Patel", email: "lina@workflowweekly.com", handle: "@workflowweekly", channelUrl: "https://workflowweekly.com", platform: "Newsletter", subtype: "Newsletter Operator", location: "San Jose, California", niche: "Productivity software", tier: "Tier A",
    whyFit: "Large permission-based product operations readership.", adminBio: "Productivity newsletter operator.", source: "Admin research", adminNotes: "First post correction outstanding.", audienceSize: 28400, engagementRate: 10.8, demographics: "73% United States", subtypeMetrics: "28,400 subscribers · 10.8% CTR", channelPermission: "Owner verified", sponsoredHistory: "Sponsor archive verified", promotionPlan: "Launch issue sponsor block", similarCampaignPerformance: "Three prior sponsor campaigns", conflicts: "None", redFlags: "Unsupported superlative in submitted post",
    verification: "verified", verificationDate: "Jun 5, 2026", providerState: "ready", accountState: "eligible", proposalAccess: "standard", invitation: "claimed",
    attention: { owner: "Affiliate", label: "Post edits requested", detail: "Remove unsupported ‘best in class’ claim · due today 5:00 PM EDT", kind: "waiting" },
    evidence: [{ id: "EV-946", name: "Newsletter analytics export.csv", kind: "document", source: "Affiliate", uploadedAt: "Jun 4 · 2:10 PM", url: "data:text/csv,subscribers,ctr%0A28400,10.8" }],
    campaigns: [campaign({ id: "CP-ARC", name: "Arcdesk Launch", founder: "Arcdesk Inc.", state: "active", stateLabel: "Correction needed", owner: "Affiliate", trackingLink: "https://proovd.co/arcdesk?via=workflowweekly", linkState: "paused", postState: "edits_requested", postVersions: [{ version: 1, url: "https://workflowweekly.com/issues/arcdesk-launch", submittedAt: "Today · 9:12 AM", status: "Edits requested" }], deliverables: [{ id: "arc-launch", title: "Launch sponsor block", state: "needs_evidence", proofUrl: "https://workflowweekly.com/issues/arcdesk-launch" }], earningsAmount: 104.4 })], cases: [], events: [event("LP1", "Today · 10:05 AM", "Post edits requested", "Exact change: remove unsupported superlative · due 5:00 PM EDT · link paused", "campaign")],
  },
  {
    id: "AF-1150", initials: "RK", name: "Riley Knox", email: "riley@makerloop.video", handle: "@makerloop", channelUrl: "https://www.youtube.com/@makerloop", platform: "YouTube", subtype: "Social Creator", location: "Columbus, Ohio", niche: "Practical maker software", tier: "Tier A",
    whyFit: "High-quality tutorial audience.", adminBio: "Maker-software tutorial creator.", source: "Admin research", adminNotes: "Healthy active relationship.", audienceSize: 39700, engagementRate: 6.2, demographics: "79% United States", subtypeMetrics: "39,700 followers · 6.2% engagement", channelPermission: "Owner verified", sponsoredHistory: "Four compliant sponsor videos", promotionPlan: "Tutorial and close reminder", similarCampaignPerformance: "$18,200 captured attributed subtotal on prior campaign", conflicts: "None", redFlags: "None",
    verification: "verified", verificationDate: "May 17, 2026", providerState: "ready", accountState: "eligible", proposalAccess: "standard", invitation: "claimed",
    evidence: [{ id: "EV-950", name: "YouTube analytics export.pdf", kind: "document", source: "Affiliate", uploadedAt: "May 16 · 3:00 PM", url: "data:text/plain,YouTube" }],
    campaigns: [campaign({ id: "CP-LOOP", name: "Looplight Launch", founder: "Looplight Labs", state: "active", stateLabel: "Active partnership", owner: "System", trackingLink: "https://proovd.co/looplight?via=makerloop", linkState: "active", postState: "approved", postVersions: [{ version: 1, url: "https://www.youtube.com/watch?v=looplight-makerloop", submittedAt: "Aug 6 · 11:05 AM", status: "Passed" }], deliverables: [{ id: "loop-video", title: "Product tutorial", state: "verified", proofUrl: "https://www.youtube.com/watch?v=looplight-makerloop" }], earningsAmount: 614.2 })], cases: [], events: [event("RK1", "Aug 6 · 12:20 PM", "First post passed", "All seven review criteria passed · $0 released · attribution remains provisional", "campaign")],
  },
  {
    id: "AF-1154", initials: "CW", name: "Caleb West", email: "caleb@growthrelay.io", handle: "@growthrelay", channelUrl: "https://growthrelay.io", platform: "Niche distribution", subtype: "Niche Distribution Partner", location: "Phoenix, Arizona", niche: "Growth communities", tier: "Tier C",
    whyFit: "Historically reached founder communities.", adminBio: "Niche growth distribution partner.", source: "Founder referral", adminNotes: "Suspended after traffic manipulation signals.", audienceSize: 15000, engagementRate: 2.1, demographics: "US-heavy estimate", subtypeMetrics: "Traffic plan under enforcement review", channelPermission: "Permission previously verified", sponsoredHistory: "Two prior campaigns", promotionPlan: "Identity-disclosed community posts", similarCampaignPerformance: "Prior campaign history retained", conflicts: "Affiliate-to-Affiliate referral relationship disclosed late", redFlags: "Artificial traffic pattern and duplicate-account signal",
    verification: "needs_evidence", providerState: "under_review", accountState: "suspended", proposalAccess: "restricted", invitation: "claimed",
    attention: { owner: "Admin", label: "Enforcement review open", detail: "Traffic manipulation evidence · appeal due in five business days", kind: "review" }, evidence: [],
    campaigns: [campaign({ id: "CP-NORTH", name: "Northstar Product Launch", founder: "Northstar Tools LLC", state: "suspended", stateLabel: "Affiliate suspended", owner: "Admin", trackingLink: "https://proovd.co/northstar?via=growthrelay", linkState: "paused", postState: "escalated", earningsAmount: -380, earningsStatus: "adjusted" })],
    cases: [{ id: "CASE-CW-1", kind: "appeal", title: "Traffic manipulation and duplicate-account review", detail: "Unpaid invalid earnings blocked; transferred amount has a $380 recovery record.", status: "open", owner: "Jordan Lee", due: "Aug 17 · 5:00 PM EDT" }],
    events: [event("CW1", "Today · 8:15 AM", "Affiliate account suspended", "Traffic evidence preserved · link paused · unpaid invalid earnings canceled · appeal route opened", "policy"), event("CW2", "Today · 8:16 AM", "Negative balance recovery recorded", "$380.00 · causal invalidity decision · original Transfer retained", "money")],
  },
];

const SEED_AFFILIATES: Affiliate[] = [...BASE_AFFILIATES, ...LIFECYCLE_AFFILIATES];

const EMPTY_CHECKS = REVIEW_CHECKS.reduce((result, item) => ({ ...result, [item.id]: true }), {} as Record<CheckId, boolean>);

export default function Home() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>(SEED_AFFILIATES);
  const [view, setView] = useState<View>("directory");
  const [selectedAffiliateId, setSelectedAffiliateId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignSection, setCampaignSection] = useState<CampaignSection>("overview");
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>("all");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<EventCategory | "all">("all");
  const [reviewStep, setReviewStep] = useState<"review" | "edits">("review");
  const [reviewChecks, setReviewChecks] = useState<Record<CheckId, boolean>>(EMPTY_CHECKS);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [toast, setToast] = useState("");
  const [fontFailed, setFontFailed] = useState(false);
  const [motionFailed, setMotionFailed] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const affiliate = affiliates.find((item) => item.id === selectedAffiliateId) ?? null;
  const selectedCampaign = affiliate?.campaigns.find((item) => item.id === selectedCampaignId) ?? affiliate?.campaigns[0] ?? null;

  const visibleAffiliates = useMemo(() => {
    const query = directoryQuery.trim().toLowerCase();
    return affiliates.filter((item) => {
      const matchesQuery = !query || `${item.name} ${item.handle} ${item.email} ${item.platform} ${item.niche}`.toLowerCase().includes(query);
      const matchesFilter = directoryFilter === "all"
        || (directoryFilter === "admin" && item.attention?.owner === "Admin")
        || (directoryFilter === "verification" && item.verification !== "verified")
        || (directoryFilter === "payout" && item.providerState !== "ready");
      return matchesQuery && matchesFilter;
    });
  }, [affiliates, directoryFilter, directoryQuery]);

  const searchResults = useMemo(() => {
    const query = globalQuery.trim().toLowerCase();
    const rows: SearchResult[] = affiliates.flatMap((item) => [
      { key: item.id, title: item.name, meta: `Affiliate · ${item.handle} · ${item.platform}`, affiliateId: item.id, target: "affiliate" },
      ...item.campaigns.map((relationship) => ({ key: `${item.id}-${relationship.id}`, title: relationship.name, meta: `${item.name} · ${relationship.stateLabel}`, affiliateId: item.id, campaignId: relationship.id, target: "campaign" as const })),
    ]);
    if (affiliate) {
      rows.push(
        { key: `${affiliate.id}-evidence`, title: `${affiliate.name} verification evidence`, meta: `${affiliate.evidence.length} evidence records`, affiliateId: affiliate.id, target: "profile" },
        { key: `${affiliate.id}-history`, title: `${affiliate.name} history`, meta: `${affiliate.events.length} recorded events`, affiliateId: affiliate.id, target: "history" },
      );
    }
    return rows.filter((item) => !query || `${item.title} ${item.meta}`.toLowerCase().includes(query)).slice(0, 12);
  }, [affiliate, affiliates, globalQuery]);

  const allChecksPass = Object.values(reviewChecks).every(Boolean);

  useEffect(() => {
    let cancelled = false;
    if (!gsap || typeof gsap.to !== "function") setMotionFailed(true);
    const timer = window.setTimeout(() => {
      if (!cancelled && !document.fonts.check("16px Satoshi")) setFontFailed(true);
    }, 3500);
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setModal(null);
      }
    }
    function press(event: PointerEvent) {
      const target = (event.target as HTMLElement).closest("button, a[data-press]");
      if (target) gsap.to(target, { scale: 0.78, duration: 0.12, ease: "power2.out", overwrite: "auto" });
    }
    function release(event: PointerEvent) {
      const target = (event.target as HTMLElement).closest("button, a[data-press]");
      if (target) gsap.to(target, { scale: 1, duration: 0.25, ease: "power3.out", overwrite: "auto" });
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", press);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", release);
    };
  }, []);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moments = root.querySelectorAll("[data-moment]");
    gsap.killTweensOf(moments);
    gsap.fromTo(moments, { y: reduced ? 0 : 16, opacity: 0 }, { y: 0, opacity: 1, duration: reduced ? 0.2 : 0.35, ease: "power3.out", stagger: reduced ? 0 : 0.05 });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [campaignSection, reviewStep, selectedAffiliateId, selectedCampaignId, view]);

  useEffect(() => {
    if (!toast) return;
    const node = document.querySelector(".toast");
    if (node) gsap.fromTo(node, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "back.out(1.7)" });
    const timer = window.setTimeout(() => {
      if (!node) return setToast("");
      gsap.to(node, { y: 20, opacity: 0, duration: 0.2, ease: "power2.in", onComplete: () => setToast("") });
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(message: string) {
    setToast("");
    window.setTimeout(() => setToast(message), 10);
  }

  function openDirectory(filter: DirectoryFilter = "all") {
    setDirectoryFilter(filter);
    setView("directory");
  }

  function openAffiliate(id: string) {
    const next = affiliates.find((item) => item.id === id);
    if (!next) return;
    setSelectedAffiliateId(id);
    setSelectedCampaignId(next.campaigns[0]?.id ?? null);
    setView("affiliate");
  }

  function openCampaign(id: string, section: CampaignSection = "overview") {
    setSelectedCampaignId(id);
    setCampaignSection(section);
    setView("campaign");
  }

  function updateAffiliate(id: string, updater: (current: Affiliate) => Affiliate) {
    setAffiliates((current) => current.map((item) => item.id === id ? updater(item) : item));
  }

  function updateCampaign(updater: (current: CampaignRelationship) => CampaignRelationship) {
    if (!affiliate || !selectedCampaign) return;
    updateAffiliate(affiliate.id, (current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => item.id === selectedCampaign.id ? updater(item) : item),
    }));
  }

  function appendEvent(title: string, detail: string, category: EventCategory, affiliateId = affiliate?.id) {
    if (!affiliateId) return;
    updateAffiliate(affiliateId, (current) => ({
      ...current,
      events: [event(`EV-${Date.now()}`, "Now · Aug 11, 2026", title, detail, category), ...current.events],
    }));
  }

  function copyLink() {
    if (!selectedCampaign) return;
    navigator.clipboard?.writeText(selectedCampaign.trackingLink).catch(() => undefined);
    showToast("Affiliate link copied");
  }

  function openSelectedProfile() {
    if (affiliate) setView("profile");
  }

  function sendPayoutReminder() {
    if (!affiliate) return;
    appendEvent("Payout reminder sent", `Stripe update link sent to ${affiliate.email}`, "money");
    showToast(`Payout reminder sent to ${affiliate.name.split(" ")[0]}`);
  }

  function refreshProvider() {
    if (!affiliate) return;
    appendEvent("Stripe status refreshed", `Provider state remains ${providerCopy(affiliate.providerState)}`, "money");
    showToast("Stripe status refreshed");
  }

  function approvePost() {
    if (!affiliate || !selectedCampaign) return;
    updateCampaign((current) => ({
      ...current,
      postState: "approved",
      linkState: "active",
      postVersions: current.postVersions.map((version, index) => index === current.postVersions.length - 1 ? { ...version, status: "Passed" } : version),
    }));
    updateAffiliate(affiliate.id, (current) => ({ ...current, attention: undefined }));
    appendEvent("Post approved", `${selectedCampaign.name} · version ${selectedCampaign.postVersions.at(-1)?.version ?? 1} · $0 released`, "campaign");
    showToast("Post approved · $0 released");
    setCampaignSection("content");
    setView("campaign");
  }

  function requestPostEdits(note: string, due: string) {
    if (!affiliate || !selectedCampaign) return;
    updateCampaign((current) => ({
      ...current,
      postState: "edits_requested",
      linkState: "paused",
      owner: "Affiliate",
      postVersions: current.postVersions.map((version, index) => index === current.postVersions.length - 1 ? { ...version, status: "Edits requested" } : version),
    }));
    updateAffiliate(affiliate.id, (current) => ({ ...current, attention: { owner: "Affiliate", label: "Post edits requested", detail: `${selectedCampaign.name} · due ${due}`, kind: "waiting" } }));
    appendEvent("Post edits requested", `${note} · Due ${due} · Affiliate link paused`, "campaign");
    showToast(`${affiliate.name.split(" ")[0]} owns the next step`);
    setCampaignSection("content");
    setView("campaign");
  }

  function handleModalAction(action: string, payload: Record<string, any> = {}) {
    if (action === "recruit") {
      const id = `AF-${1120 + affiliates.length}`;
      const fullName = String(payload.name || "New Affiliate");
      const initials = fullName.split(/\s+/).map((part: string) => part[0]).join("").slice(0, 2).toUpperCase();
      const generalEvidence = ((payload.files ?? []) as File[]).map((file) => evidenceFromFile(file, "General verification evidence"));
      const researchEvidence = evidenceFromResearchPictures((payload.researchPictures ?? emptyResearchPictures()) as ResearchPictureFiles);
      const newAffiliate: Affiliate = {
        id,
        initials,
        name: fullName,
        email: payload.email,
        phone: payload.phone,
        handle: payload.handle,
        channelUrl: payload.channelUrl,
        platform: payload.platform,
        subtype: payload.subtype,
        location: "United States · confirmation pending",
        niche: payload.niche,
        tier: payload.tier,
        whyFit: "",
        adminBio: payload.adminBio,
        source: payload.source,
        adminNotes: payload.notes,
        audienceSize: Number(payload.audienceSize || 0),
        engagementRate: Number(payload.engagementRate || 0),
        demographics: payload.demographics || "Not researched",
        subtypeMetrics: payload.subtypeMetrics || "Not researched",
        channelPermission: payload.channelPermission || "Not researched",
        sponsoredHistory: payload.sponsoredHistory || "Not researched",
        promotionPlan: payload.promotionPlan || "Not researched",
        similarCampaignPerformance: payload.similarCampaignPerformance || "No available history",
        conflicts: payload.conflicts || "None discovered",
        redFlags: payload.redFlags || "None recorded",
        verification: "under_review",
        providerState: "under_review",
        accountState: "eligible",
        proposalAccess: "standard",
        invitation: payload.sendInvite ? "sent" : "draft",
        invitationSentAt: payload.sendInvite ? "Now" : undefined,
        attention: payload.sendInvite ? { owner: "Affiliate", label: "Invitation sent", detail: `${payload.campaignName} · account claim pending`, kind: "waiting" } : undefined,
        evidence: [...researchEvidence, ...generalEvidence],
        campaigns: [campaign({ id: `CP-${Date.now()}`, name: payload.campaignName, founder: payload.founder, type: payload.campaignType, state: payload.sendInvite ? "invited" : "prospect", stateLabel: payload.sendInvite ? "Invitation sent" : "Prospect", owner: payload.sendInvite ? "Affiliate" : "Admin", designation: payload.designation, trackingLink: "Not available before activation", linkState: "inactive", kitVersion: 1 })],
        cases: [],
        events: [event(`NEW-${Date.now()}`, "Now · Aug 11, 2026", payload.sendInvite ? "Affiliate prospect created and invited" : "Affiliate prospect created", `${payload.campaignName} · ${payload.campaignType} · ${payload.designation} · ${payload.remainingTime} · created by Jordan Lee · no Affiliate account created`, "account")],
      };
      setAffiliates((current) => [newAffiliate, ...current]);
      setModal(null);
      showToast(payload.sendInvite ? "Prospect created · invitation sent" : "Affiliate prospect created");
      return;
    }

    if (!affiliate) return;

    switch (action) {
      case "save_research": {
        const fields = ["handle", "channelUrl", "subtype", "niche", "tier", "adminBio", "source", "adminNotes", "audienceSize", "engagementRate", "demographics", "subtypeMetrics", "channelPermission", "sponsoredHistory", "promotionPlan", "similarCampaignPerformance", "conflicts", "redFlags"] as const;
        const changes = fields
          .filter((key) => String(affiliate[key]) !== String(payload[key]))
          .map((key) => `${key}: ${String(affiliate[key])} → ${String(payload[key])}`);
        const researchEvidence = evidenceFromResearchPictures((payload.researchPictures ?? emptyResearchPictures()) as ResearchPictureFiles);
        updateAffiliate(affiliate.id, (current) => ({
          ...current,
          handle: payload.handle,
          channelUrl: payload.channelUrl,
          subtype: payload.subtype,
          niche: payload.niche,
          tier: payload.tier,
          adminBio: payload.adminBio,
          source: payload.source,
          adminNotes: payload.adminNotes,
          audienceSize: payload.audienceSize,
          engagementRate: payload.engagementRate,
          demographics: payload.demographics,
          subtypeMetrics: payload.subtypeMetrics,
          channelPermission: payload.channelPermission,
          sponsoredHistory: payload.sponsoredHistory,
          promotionPlan: payload.promotionPlan,
          similarCampaignPerformance: payload.similarCampaignPerformance,
          conflicts: payload.conflicts,
          redFlags: payload.redFlags,
          evidence: researchEvidence.length ? [...researchEvidence, ...current.evidence] : current.evidence,
        }));
        appendEvent("Admin research updated", `${changes.join(" · ") || "No value change"} · ${researchEvidence.length} categorized picture${researchEvidence.length === 1 ? "" : "s"} added · Reason: ${payload.reason}`, "account");
        showToast("Admin research saved · previous values preserved");
        break;
      }
      case "request_profile_correction":
        appendEvent("Affiliate correction requested", `${payload.field} · ${payload.note}`, "account");
        showToast(`Correction request sent to ${affiliate.name.split(" ")[0]}`);
        break;
      case "correct_account": {
        const key = payload.field as "name" | "email" | "phone" | "location" | "handle";
        const previous = String(affiliate[key] ?? "");
        updateAffiliate(affiliate.id, (current) => ({ ...current, [key]: payload.newValue }));
        appendEvent("Account information corrected", `${payload.label}: ${previous} → ${payload.newValue} · Reason: ${payload.reason} · Admin: Jordan Lee`, "account");
        showToast("Account information corrected · prior value preserved");
        break;
      }
      case "upload_evidence": {
        const files = payload.files as File[];
        const assets = files.map((file) => evidenceFromFile(file, "General verification evidence"));
        updateAffiliate(affiliate.id, (current) => ({ ...current, evidence: [...assets, ...current.evidence], verification: "under_review" }));
        appendEvent("Verification evidence uploaded", `${files.length} file${files.length === 1 ? "" : "s"} · associated with ${affiliate.handle}`, "evidence");
        showToast(`${files.length} evidence file${files.length === 1 ? "" : "s"} uploaded`);
        break;
      }
      case "verify_evidence":
        updateAffiliate(affiliate.id, (current) => ({ ...current, verification: "verified", verificationDate: "Aug 11, 2026", attention: current.attention?.label.includes("evidence") ? undefined : current.attention }));
        appendEvent("Audience evidence verified", `${affiliate.evidence.length} evidence records · subtype ${affiliate.subtype}`, "evidence");
        showToast("Evidence verified");
        break;
      case "request_evidence":
        updateAffiliate(affiliate.id, (current) => ({ ...current, verification: "needs_evidence", attention: { owner: "Affiliate", label: "More evidence requested", detail: payload.note, kind: "waiting" } }));
        appendEvent("More evidence requested", `${payload.metric} · ${payload.note}`, "evidence");
        showToast(`Evidence request sent to ${affiliate.name.split(" ")[0]}`);
        break;
      case "send_invitation":
      case "resend_invitation":
        updateAffiliate(affiliate.id, (current) => ({ ...current, invitation: "delivered", invitationSentAt: "Now · Aug 11, 2026", invitationDeliveredAt: "Now · Aug 11, 2026", invitationFailure: undefined, attention: { owner: "Affiliate", label: "Invitation delivered", detail: `${current.campaigns[0]?.name ?? "Campaign"} · account claim pending`, kind: "waiting" } }));
        appendEvent(action === "resend_invitation" ? "Invitation resent" : "Campaign invitation sent", `Token version rotated · ${affiliate.email}`, "account");
        showToast(action === "resend_invitation" ? "Invitation resent · previous link revoked" : "Campaign invitation sent");
        break;
      case "revoke_invitation":
        updateAffiliate(affiliate.id, (current) => ({ ...current, invitation: "revoked", attention: undefined }));
        appendEvent("Invitation revoked", `${payload.reason} · draft retention clock preserved`, "account");
        showToast("Invitation revoked");
        break;
      case "assign_campaign": {
        const relationship = campaign({ id: `CP-${Date.now()}`, name: payload.campaignName, founder: payload.founder, designation: payload.designation, state: "prospect", stateLabel: "Prospect", owner: "Admin", trackingLink: "Not available before activation", linkState: "inactive", kitVersion: 1 });
        updateAffiliate(affiliate.id, (current) => ({ ...current, campaigns: [...current.campaigns, relationship] }));
        appendEvent("Affiliate assigned to campaign", `${payload.campaignName} · ${payload.designation} · ${payload.reason}`, "campaign");
        showToast("Campaign relationship created");
        break;
      }
      case "save_relationship":
        updateCampaign((current) => ({ ...current, designation: payload.designation }));
        appendEvent("Non-material campaign relationship update recorded", `${selectedCampaign?.designation} → ${payload.designation} · ${payload.recruitmentSource} · ${payload.reason} · Affiliate readiness preserved`, "campaign");
        showToast("Campaign relationship data saved");
        break;
      case "require_relationship_reacceptance":
        updateCampaign((current) => ({ ...current, stateLabel: "Affiliate reacceptance required", owner: "Affiliate", linkState: current.linkState === "active" ? "paused" : current.linkState }));
        updateAffiliate(affiliate.id, (current) => ({ ...current, attention: { owner: "Affiliate", label: "Campaign terms need reacceptance", detail: `${selectedCampaign?.name} · ${payload.version}`, kind: "waiting" } }));
        appendEvent("Affiliate campaign reacceptance required", `${payload.version} · ${payload.changedField}: ${payload.previousValue} → ${payload.newValue} · Material change reason: ${payload.reason}`, "campaign");
        showToast("Affiliate reacceptance requested");
        break;
      case "replace_link": {
        if (!selectedCampaign) break;
        const suffix = Math.random().toString(36).slice(2, 7);
        const oldLink = selectedCampaign.trackingLink;
        const base = oldLink.includes("?") ? oldLink.split("?")[0] : `https://proovd.co/${selectedCampaign.id.toLowerCase()}`;
        const nextLink = `${base}?via=${affiliate.handle.replace("@", "")}-${suffix}`;
        updateCampaign((current) => ({ ...current, trackingLink: nextLink, linkState: "active" }));
        appendEvent("Affiliate link replaced", `${oldLink} → ${nextLink} · ${payload.reason} · recent reauthentication · idempotency record`, "campaign");
        showToast("Replacement Affiliate link generated");
        break;
      }
      case "pause_link":
        updateCampaign((current) => ({ ...current, linkState: "paused" }));
        appendEvent("Affiliate link paused", `${payload.reason} · recent reauthentication`, "campaign");
        showToast("Affiliate link paused");
        break;
      case "reactivate_link":
        updateCampaign((current) => ({ ...current, linkState: "active" }));
        appendEvent("Affiliate link reactivated", `${payload.reason} · recent reauthentication`, "campaign");
        showToast("Affiliate link reactivated");
        break;
      case "safe_test_link":
        appendEvent("Affiliate link safe test completed", `${selectedCampaign?.trackingLink} · test traffic excluded from attribution and conversion metrics`, "campaign");
        showToast("Safe test passed · no production attribution created");
        break;
      case "proposal_mediation":
        appendEvent("Proposal mediation recorded", `Admin note: ${payload.note} · bilateral acceptance remains required`, "campaign");
        showToast("Mediation note recorded");
        break;
      case "proposal_reject":
        updateCampaign((current) => ({ ...current, agreementState: "expired", stateLabel: "Proposal needs revision", owner: "Affiliate" }));
        appendEvent("Policy-invalid proposal rejected", payload.reason, "campaign");
        showToast("Proposal returned for revision");
        break;
      case "post_resubmission": {
        if (!selectedCampaign) break;
        const nextVersion = (selectedCampaign.postVersions.at(-1)?.version ?? 0) + 1;
        updateCampaign((current) => ({ ...current, postState: "submitted", owner: "Admin", postVersions: [...current.postVersions, { version: nextVersion, url: payload.url, submittedAt: "Now · Aug 11, 2026", status: "Submitted" }] }));
        updateAffiliate(affiliate.id, (current) => ({ ...current, attention: { owner: "Admin", label: "Corrected post submitted", detail: `${selectedCampaign.name} · version ${nextVersion}`, kind: "review" } }));
        setReviewChecks(EMPTY_CHECKS);
        appendEvent("Corrected post recorded", `${payload.url} · version ${nextVersion} · previous submission preserved`, "campaign");
        showToast(`Corrected post version ${nextVersion} ready for review`);
        break;
      }
      case "post_reject":
      case "post_escalate": {
        const serious = action === "post_escalate";
        updateCampaign((current) => ({ ...current, postState: serious ? "escalated" : "rejected", linkState: "paused", owner: "Admin", postVersions: current.postVersions.map((version, index) => index === current.postVersions.length - 1 ? { ...version, status: serious ? "Escalated" : "Rejected" } : version) }));
        const nextCase: SupportCase = { id: `CASE-${Date.now()}`, kind: serious ? "appeal" : "conflict", title: serious ? "Serious post breach" : "Rejected submitted post", detail: payload.reason, status: "open", owner: "Jordan Lee", due: "Today · 4:00 PM EDT" };
        updateAffiliate(affiliate.id, (current) => ({ ...current, attention: { owner: "Admin", label: serious ? "Serious issue escalated" : "Post rejected · case open", detail: payload.reason, kind: "review" }, cases: [nextCase, ...current.cases] }));
        appendEvent(serious ? "Serious post issue escalated" : "Submitted post rejected", `${payload.reason} · Affiliate link paused`, "policy");
        showToast(serious ? "Serious issue escalated" : "Post rejected · case opened");
        setView("controls");
        break;
      }
      case "deliverable_verify":
      case "deliverable_more_evidence":
      case "deliverable_waive": {
        if (!selectedCampaign || !modal?.deliverableId) break;
        const nextState = action === "deliverable_verify" ? "verified" : action === "deliverable_waive" ? "waived" : "needs_evidence";
        updateCampaign((current) => ({ ...current, deliverables: current.deliverables.map((item) => item.id === modal.deliverableId ? { ...item, state: nextState } : item) }));
        appendEvent(action === "deliverable_verify" ? "Deliverable verified" : action === "deliverable_waive" ? "Deliverable waived" : "More deliverable evidence requested", `${selectedCampaign.name} · ${payload.note || "Structured review recorded"}`, "campaign");
        showToast(action === "deliverable_verify" ? "Deliverable verified" : action === "deliverable_waive" ? "Founder/Admin waiver recorded" : "Evidence request sent");
        break;
      }
      case "availability_verify":
        updateCampaign((current) => ({ ...current, availabilityVerified: true }));
        appendEvent("Availability period verified", `${payload.through} · evidence ${payload.evidence}`, "campaign");
        showToast("Availability period verified");
        break;
      case "transfer":
        updateCampaign((current) => ({ ...current, earningsStatus: "transferred" }));
        appendEvent("Affiliate Transfer created", `$${selectedCampaign?.earningsAmount.toFixed(2)} · idempotency key recorded · recent reauthentication`, "money");
        showToast("Affiliate Transfer created once");
        break;
      case "adjust_earnings":
        updateCampaign((current) => ({ ...current, earningsAmount: Number(payload.amount), earningsStatus: "adjusted" }));
        appendEvent(Number(payload.amount) < 0 ? "Negative balance recovery recorded" : "Affiliate earnings adjusted", `$${selectedCampaign?.earningsAmount.toFixed(2)} → $${Number(payload.amount).toFixed(2)} · ${payload.reason} · recent reauthentication`, "money");
        showToast(Number(payload.amount) < 0 ? "Negative balance recovery recorded" : "Earnings adjustment recorded");
        break;
      case "fixed_eligible":
      case "fixed_return":
        updateCampaign((current) => ({ ...current, fixedPayment: action === "fixed_eligible" ? `${current.fixedPayment.split("·")[0].trim()} · eligible` : `${current.fixedPayment.split("·")[0].trim()} · return to Founder` }));
        appendEvent(action === "fixed_eligible" ? "Upfront fee marked eligible" : "Upfront fee return required", payload.reason, "money");
        showToast(action === "fixed_eligible" ? "Upfront fee eligibility recorded" : "Upfront fee return recorded");
        break;
      case "completion_approve":
      case "completion_decline":
        updateCampaign((current) => ({ ...current, completion: action === "completion_approve" ? "successful" : "disqualified", stateLabel: action === "completion_approve" ? "Successfully completed" : "Completion disqualified", owner: "System" }));
        updateAffiliate(affiliate.id, (current) => ({ ...current, attention: undefined }));
        appendEvent(action === "completion_approve" ? "Successful completion approved" : "Completion declined", payload.reason, "campaign");
        showToast(action === "completion_approve" ? "Successful completion recorded" : "Completion declined");
        break;
      case "completion_correct":
        updateCampaign((current) => ({ ...current, completion: "review_due", stateLabel: "Completion correction under review", workAgain: current.workAgain === "requested" ? "none" : current.workAgain, owner: "Admin" }));
        appendEvent("Completion record corrected", `${payload.reason} · prior completion decision retained · work-again eligibility recalculated`, "campaign");
        showToast("Completion correction recorded");
        break;
      case "work_again_reissue":
        appendEvent("Work-again request reissued", "Original Founder request retained · Affiliate response still required", "campaign");
        showToast("Work-again request reissued");
        break;
      case "payout_reminder":
        sendPayoutReminder();
        break;
      case "record_case": {
        const kind = payload.kind as CaseKind;
        const labels: Record<CaseKind, string> = { conflict: "Affiliate conflict disclosure", self_preorder: "Affiliate self-preorder", termination: "Active termination request", creator_failure: "Required Creator failure", appeal: "Affiliate policy appeal", support: "Affiliate support case", refund: "Refund / cause-allocation review", payout_recovery: "Payout / Transfer recovery", negative_balance: "Negative balance recovery", deletion: "Account deletion and retention review" };
        const newCase: SupportCase = { id: `CASE-${Date.now()}`, kind, title: labels[kind], detail: payload.detail, status: "open", owner: "Jordan Lee", due: payload.due };
        updateAffiliate(affiliate.id, (current) => ({ ...current, cases: [newCase, ...current.cases], attention: { owner: "Admin", label: labels[kind], detail: payload.detail, kind: "review" } }));
        appendEvent("Compliance/support case recorded", `${labels[kind]} · ${payload.detail}`, "policy");
        showToast("Case recorded · review is ready");
        break;
      }
      case "resolve_case":
        if (!modal?.caseId) break;
        {
          const resolvedCase = affiliate.cases.find((item) => item.id === modal.caseId);
          if (resolvedCase?.kind === "creator_failure" && String(payload.outcome).startsWith("Record failure")) {
            updateCampaign((current) => ({ ...current, state: "creator_replacement", stateLabel: "Creator replacement · due in three US business days", owner: "Admin", linkState: "inactive" }));
          }
          if (resolvedCase?.kind === "termination" && String(payload.outcome).startsWith("Approve")) {
            updateCampaign((current) => ({ ...current, state: "removed", stateLabel: "Affiliate-requested termination approved", owner: "System", linkState: "inactive" }));
          }
          if (resolvedCase?.kind === "conflict" && String(payload.outcome).startsWith("Suspend")) {
            updateCampaign((current) => ({ ...current, stateLabel: "Conflict review restriction", owner: "Admin", linkState: "paused" }));
          }
          if (resolvedCase?.kind === "appeal" && String(payload.outcome).startsWith("Restore")) {
            updateAffiliate(affiliate.id, (current) => ({ ...current, accountState: "eligible" }));
          }
        }
        updateAffiliate(affiliate.id, (current) => ({ ...current, cases: current.cases.map((item) => item.id === modal.caseId ? { ...item, status: "resolved" } : item), attention: undefined }));
        appendEvent("Case decision recorded", `${payload.outcome} · ${payload.reason}`, "policy");
        showToast("Case decision recorded");
        break;
      case "warning":
        appendEvent("Affiliate warning issued", `${payload.category} · ${payload.customerCopy} · appeal due ${payload.appealDue}`, "policy");
        showToast("Warning issued · audit event created");
        break;
      case "suspend":
        updateAffiliate(affiliate.id, (current) => ({ ...current, accountState: "suspended", attention: { owner: "Admin", label: "Affiliate account suspended", detail: payload.customerCopy, kind: "review" } }));
        updateCampaign((current) => ({ ...current, linkState: "paused" }));
        appendEvent("Affiliate account suspended", `${payload.category} · ${payload.internalReason} · recent reauthentication`, "policy");
        showToast("Affiliate account suspended");
        break;
      case "restore":
        updateAffiliate(affiliate.id, (current) => ({ ...current, accountState: "eligible", attention: undefined }));
        appendEvent("Affiliate account restored", `${payload.reason} · recent reauthentication`, "policy");
        showToast("Affiliate account restored");
        break;
      case "remove":
        updateCampaign((current) => ({ ...current, state: "removed", stateLabel: "Removed from campaign", owner: "System", linkState: "inactive" }));
        appendEvent("Affiliate removed from campaign", `${payload.reason} · money treatment: ${payload.moneyTreatment} · recent reauthentication`, "policy");
        showToast("Affiliate removed from campaign");
        break;
      case "campaign_suspend":
      case "campaign_kill": {
        const killed = action === "campaign_kill";
        updateCampaign((current) => ({ ...current, state: killed ? "killed" : "suspended", stateLabel: killed ? "Campaign killed" : "Campaign suspended", owner: "Admin", linkState: "paused" }));
        appendEvent(killed ? "Campaign killed" : "Campaign suspended", `${payload.phase} · ${payload.reason} · ${payload.moneyTreatment} · page and evidence preserved · recent reauthentication`, "policy");
        showToast(killed ? "Campaign killed · recovery opened" : "Campaign suspended");
        break;
      }
      case "access_decision":
        updateAffiliate(affiliate.id, (current) => ({ ...current, tier: payload.tier, proposalAccess: payload.proposalAccess }));
        appendEvent("Internal tier or proposal access changed", `${affiliate.tier} → ${payload.tier} · ${affiliate.proposalAccess} → ${payload.proposalAccess} · ${payload.reason}`, "policy");
        showToast("Access decision recorded");
        break;
      case "policy_reacceptance":
        updateAffiliate(affiliate.id, (current) => ({
          ...current,
          policyState: "reacceptance_required",
          attention: { owner: "Affiliate", label: "Policy reacceptance required", detail: `${payload.version} · continued use paused`, kind: "waiting" },
          campaigns: current.campaigns.map((item) => ({ ...item, linkState: item.linkState === "active" ? "paused" : item.linkState })),
        }));
        appendEvent("Current policy reacceptance required", `${payload.version} · ${payload.reason}`, "policy");
        showToast("Policy acceptance request sent");
        break;
      case "password_recovery":
        appendEvent("Password recovery link issued", `${affiliate.email} · non-enumerating transactional delivery · token value not logged`, "account");
        showToast("Password recovery link sent");
        break;
      case "deletion_request":
        updateAffiliate(affiliate.id, (current) => ({ ...current, deletionState: "retention_review", attention: { owner: "Admin", label: "Account deletion review", detail: "Active obligations and seven-year retention requirements must be resolved", kind: "review" } }));
        appendEvent("Account deletion request recorded", `${payload.reason} · active campaign, tax, provider and audit retention review opened`, "account");
        showToast("Deletion request recorded · retention review opened");
        break;
    }
    setModal(null);
  }

  function chooseSearch(result: SearchResult) {
    setSearchOpen(false);
    setGlobalQuery("");
    setSelectedAffiliateId(result.affiliateId);
    const found = affiliates.find((item) => item.id === result.affiliateId);
    const campaignId = result.campaignId ?? found?.campaigns[0]?.id ?? null;
    setSelectedCampaignId(campaignId);
    if (result.target === "campaign") setView("campaign");
    else if (result.target === "profile") setView("profile");
    else if (result.target === "history") setView("history");
    else setView("affiliate");
  }

  return (
    <div className="app" ref={pageRef}>
      {fontFailed && <div className="font-alert" role="status"><AlertTriangle size={16} /> Satoshi didn’t load</div>}
      {motionFailed && <div className="font-alert" role="status"><AlertTriangle size={16} /> Motion failed to load</div>}
      <Topbar
        hasAffiliate={Boolean(affiliate)}
        onDirectory={openDirectory}
        onSearch={() => setSearchOpen(true)}
        onAccount={() => setModal({ type: "admin_account" })}
      />

      {view === "directory" && (
        <AffiliateDirectory
          affiliates={visibleAffiliates}
          total={affiliates.length}
          query={directoryQuery}
          filter={directoryFilter}
          onQuery={setDirectoryQuery}
          onFilter={setDirectoryFilter}
          onOpen={openAffiliate}
          onRecruit={() => setModal({ type: "recruit" })}
        />
      )}

      {view === "affiliate" && affiliate && (
        <AffiliateRecord
          affiliate={affiliate}
          onBack={() => openDirectory("all")}
          onProfile={() => setView("profile")}
          onControls={() => setView("controls")}
          onHistory={() => setView("history")}
          onCampaign={openCampaign}
          onAssign={() => setModal({ type: "assign_campaign" })}
          onAttention={() => {
            if (!affiliate.attention) return;
            if (affiliate.attention.label.toLowerCase().includes("post")) {
              const c = affiliate.campaigns.find((item) => item.postState === "submitted" || item.postState === "rejected" || item.postState === "escalated");
              if (c) { setSelectedCampaignId(c.id); setView(c.postState === "submitted" ? "review" : "controls"); }
            } else if (affiliate.attention.label.toLowerCase().includes("evidence")) setView("profile");
            else if (affiliate.attention.label.toLowerCase().includes("invitation")) setModal({ type: "invitation" });
            else if (affiliate.attention.label.toLowerCase().includes("completion")) setModal({ type: "completion" });
            else if (affiliate.attention.owner === "Stripe") setModal({ type: "payout_reminder" });
            else openCampaign(affiliate.campaigns[0].id, "agreement");
          }}
          onPayoutReminder={() => setModal({ type: "payout_reminder" })}
        />
      )}

      {view === "profile" && affiliate && (
        <ProfileView
          affiliate={affiliate}
          onBack={() => setView("affiliate")}
          onModal={(type, evidenceId) => setModal({ type, evidenceId })}
          onRefresh={refreshProvider}
          onReminder={() => setModal({ type: "payout_reminder" })}
        />
      )}

      {view === "campaign" && affiliate && selectedCampaign && (
        <CampaignView
          affiliate={affiliate}
          campaign={selectedCampaign}
          section={campaignSection}
          onSection={setCampaignSection}
          onBack={() => setView("affiliate")}
          onProfile={openSelectedProfile}
          onReview={() => { setReviewStep("review"); setView("review"); }}
          onCopy={copyLink}
          onControls={() => setView("controls")}
          onModal={(type, context) => setModal({ type, ...context })}
          onReminder={() => setModal({ type: "payout_reminder" })}
          onRefresh={refreshProvider}
        />
      )}

      {view === "review" && affiliate && selectedCampaign && (
        <PostReview
          affiliate={affiliate}
          campaign={selectedCampaign}
          step={reviewStep}
          checks={reviewChecks}
          allChecksPass={allChecksPass}
          onToggle={(id) => setReviewChecks((current) => ({ ...current, [id]: !current[id] }))}
          onStep={setReviewStep}
          onBack={() => reviewStep === "edits" ? setReviewStep("review") : openCampaign(selectedCampaign.id, "content")}
          onApprove={approvePost}
          onRequestEdits={requestPostEdits}
          onReject={() => setModal({ type: "post_reject" })}
          onEscalate={() => setModal({ type: "post_escalate" })}
          onHistory={() => setModal({ type: "post_history" })}
        />
      )}

      {view === "controls" && affiliate && (
        <ControlsView
          affiliate={affiliate}
          campaign={selectedCampaign}
          onBack={() => setView("affiliate")}
          onModal={(type, caseId) => setModal({ type, caseId })}
          onHistory={() => setView("history")}
        />
      )}

      {view === "history" && affiliate && (
        <HistoryView affiliate={affiliate} filter={historyFilter} onFilter={setHistoryFilter} onBack={() => setView("affiliate")} />
      )}

      {toast && <div className="toast" role="status"><CheckCircle2 size={18} /> {toast}</div>}
      {searchOpen && <SearchModal query={globalQuery} results={searchResults} onQuery={setGlobalQuery} onChoose={chooseSearch} onClose={() => setSearchOpen(false)} />}
      {modal && (
        <ModalRouter
          key={`${modal.type}-${modal.evidenceId ?? ""}-${modal.deliverableId ?? ""}-${modal.caseId ?? ""}`}
          modal={modal}
          affiliate={affiliate}
          campaign={selectedCampaign}
          onClose={() => setModal(null)}
          onAction={handleModalAction}
        />
      )}
    </div>
  );
}

interface SearchResult {
  key: string;
  title: string;
  meta: string;
  affiliateId: string;
  campaignId?: string;
  target: "affiliate" | "campaign" | "profile" | "history";
}

function Topbar({ hasAffiliate, onDirectory, onSearch, onAccount }: {
  hasAffiliate: boolean;
  onDirectory: (filter?: DirectoryFilter) => void;
  onSearch: () => void;
  onAccount: () => void;
}) {
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => onDirectory("all")} aria-label="Open All Affiliates">proovd<span>.</span></button>
      <button className="search-button" onClick={onSearch}><Search size={18} /><span>Find an Affiliate, campaign, post…</span><kbd>/</kbd></button>
      <button className="admin-avatar" onClick={onAccount} aria-label={`Open Admin account${hasAffiliate ? "" : " settings"}`}>JL</button>
    </header>
  );
}

function AffiliateDirectory({ affiliates, total, query, filter, onQuery, onFilter, onOpen, onRecruit }: {
  affiliates: Affiliate[];
  total: number;
  query: string;
  filter: DirectoryFilter;
  onQuery: (value: string) => void;
  onFilter: (filter: DirectoryFilter) => void;
  onOpen: (id: string) => void;
  onRecruit: () => void;
}) {
  const labels: Record<DirectoryFilter, string> = { all: "All Affiliates", admin: "Admin work", verification: "Verification", payout: "Payout issues" };
  return (
    <main className="directory-page">
      <section className="directory-hero" data-moment>
        <div><p className="eyebrow">Affiliate workspace</p><h1>{labels[filter]}</h1><p>{affiliates.length} of {total} Affiliates</p></div>
        <button className="primary" onClick={onRecruit}><UserPlus size={18} /> Add Affiliate</button>
      </section>

      <section className="directory-tools" data-moment>
        <label className="directory-search"><Search size={19} /><span className="sr-only">Search Affiliates</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search name, handle, email, channel…" /></label>
        <div className="filter-buttons" aria-label="Affiliate directory filters">
          <Filter size={17} />
          {(["all", "admin", "verification", "payout"] as DirectoryFilter[]).map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => onFilter(item)}>{labels[item]}</button>)}
        </div>
      </section>

      <section className="directory-list" data-moment aria-label="Affiliate directory">
        <div className="directory-heading" aria-hidden="true"><span>Affiliate</span><span>Verification</span><span>Campaigns</span><span>Current state</span><span /></div>
        {affiliates.map((item) => (
          <article className="affiliate-row" key={item.id}>
            <div className="affiliate-cell identity-cell"><span className="row-monogram">{item.initials}</span><span><strong>{item.name}</strong><small>{item.handle} · {item.platform}</small></span></div>
            <div className="affiliate-cell"><span className={`state-text state-${item.verification}`}>{verificationCopy(item.verification)}</span><small>{item.verificationDate ?? "Decision pending"}</small></div>
            <div className="affiliate-cell"><strong>{item.campaigns.filter((relationship) => relationship.state === "active").length} active</strong><small>{item.campaigns.length} total · {item.campaigns[0]?.stateLabel}</small></div>
            <div className="affiliate-cell attention-cell">
              {item.attention ? <><span className={`owner-dot owner-${item.attention.owner.toLowerCase()}`}>{item.attention.owner}</span><strong>{item.attention.label}</strong><small>{item.attention.detail}</small></> : <><strong>{item.campaigns[0]?.stateLabel ?? invitationCopy(item.invitation)}</strong><small>{item.providerState === "ready" ? `${item.campaigns.length} campaign relationship${item.campaigns.length === 1 ? "" : "s"}` : providerCopy(item.providerState)}</small></>}
            </div>
            <button className="secondary row-action" onClick={() => onOpen(item.id)}>View Affiliate record <ArrowRight size={16} /></button>
          </article>
        ))}
        {affiliates.length === 0 && <div className="empty-directory"><UsersRound size={28} /><h2>No Affiliates match</h2><button className="secondary" onClick={() => { onQuery(""); onFilter("all"); }}>Clear Affiliate filters</button></div>}
      </section>
    </main>
  );
}

function AffiliateRecord({ affiliate, onBack, onProfile, onControls, onHistory, onCampaign, onAssign, onAttention, onPayoutReminder }: {
  affiliate: Affiliate;
  onBack: () => void;
  onProfile: () => void;
  onControls: () => void;
  onHistory: () => void;
  onCampaign: (id: string, section?: CampaignSection) => void;
  onAssign: () => void;
  onAttention: () => void;
  onPayoutReminder: () => void;
}) {
  return (
    <main>
      <section className="identity-band" data-moment>
        <div className="identity-topline"><button className="back-control" onClick={onBack}><ArrowLeft size={16} /> All Affiliates</button><span>{affiliate.id}</span></div>
        <div className="identity-layout">
          <div className="identity-person"><div className="monogram">{affiliate.initials}</div><div><p>{affiliate.subtype} · {affiliate.niche}</p><h1>{affiliate.name}</h1><a href={affiliate.channelUrl} target="_blank" rel="noreferrer" data-press>{affiliate.handle} · {affiliate.platform} <ExternalLink size={14} /></a><span>{affiliate.location}</span></div></div>
          <div className="identity-actions">
            <button className="secondary" onClick={onProfile}><UserRound size={17} /> View profile & evidence</button>
            <button className="secondary" onClick={onControls}><ShieldCheck size={17} /> View account controls</button>
            <button className="tertiary" onClick={onHistory}><History size={17} /> View full history</button>
          </div>
        </div>
        <dl className="identity-facts">
          <div><dt>Verification</dt><dd>{verificationCopy(affiliate.verification)}</dd></div>
          <div><dt>Active partnerships</dt><dd>{affiliate.campaigns.filter((item) => item.state === "active").length} of 3</dd></div>
          <div><dt>Payout</dt><dd>{providerCopy(affiliate.providerState)}</dd></div>
          <div><dt>Account</dt><dd>{affiliate.policyState === "reacceptance_required" ? "Policy acceptance required" : affiliate.accountState === "eligible" ? "Eligible" : "Suspended"}</dd></div>
        </dl>
      </section>

      <div className="record-wrap">
        {affiliate.attention && (
          <section className={`attention-object attention-${affiliate.attention.owner.toLowerCase()}`} data-moment>
            <div><span className={`owner-dot owner-${affiliate.attention.owner.toLowerCase()}`}>Owner · {affiliate.attention.owner}</span><h2>{affiliate.attention.label}</h2><p>{affiliate.attention.detail}</p></div>
            {affiliate.attention.owner === "Admin" && <button className="primary" onClick={onAttention}>{attentionAction(affiliate.attention)} <ArrowRight size={18} /></button>}
            {affiliate.attention.owner === "Stripe" && <button className="secondary" onClick={onPayoutReminder}>Send payout reminder <Send size={17} /></button>}
            {affiliate.attention.owner === "Founder" && <button className="secondary" onClick={onAttention}>View commercial proposal <ArrowRight size={17} /></button>}
          </section>
        )}

        <section className="relationship-section" data-moment>
          <header className="section-head"><div><p className="eyebrow">Campaign relationships</p><h2>{affiliate.campaigns.length} campaign{affiliate.campaigns.length === 1 ? "" : "s"}</h2></div><button className="secondary" onClick={onAssign}><Plus size={17} /> Assign to another campaign</button></header>
          <div className="relationship-list">
            {affiliate.campaigns.map((relationship) => (
              <article className="relationship-row" key={relationship.id}>
                <span className={`relationship-mark ${relationship.state === "active" ? "active-mark" : ""}`}><BriefcaseBusiness size={20} /></span>
                <span className="relationship-main"><strong>{relationship.name}</strong><small>{relationship.founder} · {relationship.designation}</small></span>
                <span className={`owner-dot owner-${relationship.owner.toLowerCase()}`}>Owner · {relationship.owner}</span>
                <span className="relationship-state"><strong>{relationship.stateLabel}</strong><small>{relationship.closes}</small></span>
                <button className="secondary" onClick={() => onCampaign(relationship.id)}>View campaign relationship <ChevronRight size={16} /></button>
              </article>
            ))}
          </div>
        </section>

        <section className="quiet-status-line" data-moment>
          <div><BadgeCheck size={20} /><span><strong>{verificationCopy(affiliate.verification)}</strong><small>{affiliate.evidence.length} evidence records</small></span></div>
          <div><CircleDollarSign size={20} /><span><strong>{providerCopy(affiliate.providerState)}</strong><small>Stripe-owned state</small></span></div>
          <button className="tertiary" onClick={onProfile}>Inspect account details <ArrowRight size={16} /></button>
        </section>
      </div>
    </main>
  );
}

function ProfileView({ affiliate, onBack, onModal, onRefresh, onReminder }: {
  affiliate: Affiliate;
  onBack: () => void;
  onModal: (type: ModalType, evidenceId?: string) => void;
  onRefresh: () => void;
  onReminder: () => void;
}) {
  return (
    <main className="focused-page">
      <ContextHeader eyebrow={`${affiliate.name} · Account level`} title="Profile & evidence" onBack={onBack} backLabel={`Back to ${affiliate.name}`} />
      <div className="focused-wrap profile-layout">
        <section className="profile-summary" data-moment>
          <div><p className="eyebrow">Public presence</p><h2>{affiliate.handle}</h2><a className="external-text-link" href={affiliate.channelUrl} target="_blank" rel="noreferrer" data-press>Open {affiliate.platform} channel <ExternalLink size={16} /></a></div>
          <dl><div><dt>Subtype</dt><dd>{affiliate.subtype}</dd></div><div><dt>Verification</dt><dd>{verificationCopy(affiliate.verification)}</dd></div><div><dt>Payout</dt><dd>{providerCopy(affiliate.providerState)}</dd></div></dl>
        </section>

        <section className="profile-section combined-profile-section" data-moment>
          <header className="profile-section-head combined-profile-head"><div><p className="eyebrow">Profile</p><h3>Account &amp; research</h3></div></header>
          <div className="profile-source-block account-profile-block">
            <header className="profile-subsection-head"><div><span className="provenance provenance-affiliate">Affiliate supplied</span><h4>Account details</h4></div><div className="provider-actions"><button className="secondary" onClick={() => onModal("account_correction")}><Pencil size={16} /> Correct account information</button><button className="tertiary" onClick={() => onModal("profile_correction")}><Mail size={16} /> Request Affiliate correction</button></div></header>
            <dl className="fact-grid"><div><dt>Name</dt><dd>{affiliate.name}</dd></div><div><dt>Username</dt><dd>{affiliate.handle}</dd></div><div><dt>Email</dt><dd>{affiliate.email}</dd></div><div><dt>Phone number</dt><dd>{affiliate.phone ? `${affiliate.phone} · unverified` : "Not supplied"}</dd></div><div><dt>Location</dt><dd>{affiliate.country ?? "United States"} · {affiliate.state ?? affiliate.location}</dd></div><div><dt>Date of birth / age</dt><dd>{affiliate.dateOfBirth ?? (affiliate.claimedAt ? "Restricted field · 18+ confirmed" : "Not claimed")}</dd></div><div className="wide-fact"><dt>Eligibility representations</dt><dd>{affiliate.actualOperatorConfirmed === false ? "Operator confirmation needs review" : "18+ · actual operator · US participant · no duplicate account · sanctions eligible"}</dd></div><div><dt>Account claimed</dt><dd>{affiliate.claimedAt ?? "Not claimed"}</dd></div><div><dt>Terms</dt><dd>{affiliate.termsVersion ?? "Current version pending claim"}</dd></div><div><dt>Affiliate AUP</dt><dd>{affiliate.aupVersion ?? "Current version pending claim"}</dd></div></dl>
          </div>
          <div className="profile-source-block research-profile-block">
            <header className="profile-subsection-head"><div><span className="provenance provenance-admin">Admin researched / authored</span><h4>Channel details</h4></div><button className="secondary" onClick={() => onModal("research")}><Pencil size={16} /> Edit audience research</button></header>
            <dl className="fact-grid">
              <div><dt>Researched username</dt><dd>{affiliate.handle}</dd></div><div><dt>Channel subtype</dt><dd>{affiliate.subtype}</dd></div>
              <div><dt>Niche</dt><dd>{affiliate.niche}</dd></div><div><dt>Internal quality tier</dt><dd>{affiliate.tier}</dd></div>
              <div><dt>Recruitment source</dt><dd>{affiliate.source}</dd></div><div><dt>Audience size</dt><dd>{affiliate.audienceSize.toLocaleString()}</dd></div>
              <div className="wide-fact"><dt>Admin bio</dt><dd>{affiliate.adminBio}</dd></div>
              <div className="wide-fact"><dt>Subtype metrics</dt><dd>{affiliate.subtypeMetrics ?? "Not researched"}</dd></div>
              <div className="wide-fact"><dt>Channel ownership / permission</dt><dd>{affiliate.channelPermission ?? "Not researched"}</dd></div>
              <div className="wide-fact"><dt>Sponsored-content history</dt><dd>{affiliate.sponsoredHistory ?? "Not researched"}</dd></div>
              <div className="wide-fact"><dt>Promotion plan</dt><dd>{affiliate.promotionPlan ?? "Not researched"}</dd></div>
              <div className="wide-fact"><dt>Similar-campaign performance</dt><dd>{affiliate.similarCampaignPerformance ?? "No available history"}</dd></div>
              <div><dt>Conflicts</dt><dd>{affiliate.conflicts ?? "None recorded"}</dd></div><div><dt>Red flags</dt><dd>{affiliate.redFlags ?? "None recorded"}</dd></div>
              <div className="wide-fact"><dt>Internal notes</dt><dd>{affiliate.adminNotes}</dd></div>
            </dl>
          </div>
        </section>

        <section className="profile-section" data-moment>
          <header className="profile-section-head"><div><span className="provenance provenance-evidence">Evidence + Admin decision</span><h3>Audience verification</h3></div><span className={`verification-mark verification-${affiliate.verification}`}>{verificationCopy(affiliate.verification)}</span></header>
          <div className="metric-evidence">
            <dl><div><dt>Audience size</dt><dd>{affiliate.audienceSize.toLocaleString()}</dd></div><div><dt>{verificationMetricLabel(affiliate.subtype)}</dt><dd>{affiliate.engagementRate ? `${affiliate.engagementRate}%` : "Evidence needed"}</dd></div><div><dt>Demographics</dt><dd>{affiliate.demographics}</dd></div><div><dt>Subtype evidence</dt><dd>{affiliate.subtypeMetrics ?? "Evidence needed"}</dd></div><div><dt>Ownership / permission</dt><dd>{affiliate.channelPermission ?? "Evidence needed"}</dd></div><div><dt>Sponsored history / plan</dt><dd>{affiliate.sponsoredHistory ?? affiliate.promotionPlan ?? "Evidence needed"}</dd></div></dl>
            <div className="evidence-grid">
              {affiliate.evidence.map((asset) => <button className="evidence-file" key={asset.id} onClick={() => onModal("evidence", asset.id)}><EvidencePreview asset={asset} /><span><strong>{asset.name}</strong><small>{asset.category ? `${asset.category} · ` : ""}{asset.source} supplied · {asset.uploadedAt}</small><b><Eye size={15} /> View evidence</b></span></button>)}
            </div>
          </div>
          <div className="context-actions">
            <button className="primary" onClick={() => onModal("verify_evidence")}><BadgeCheck size={17} /> Verify audience evidence</button>
            <button className="secondary" onClick={() => onModal("request_evidence")}><Mail size={17} /> Request more evidence</button>
            <button className="tertiary" onClick={() => onModal("upload_evidence")}><Upload size={17} /> Upload Admin research evidence</button>
          </div>
        </section>

        <section className={`provider-strip provider-${affiliate.providerState}`} data-moment>
          <div><span className="provenance provenance-provider">Stripe supplied · read only</span><h3>{providerCopy(affiliate.providerState)}</h3><p>{affiliate.providerState === "ready" ? "Transfers enabled · tax information complete" : affiliate.providerState === "needs_information" ? "Bank information required · Affiliate must update Stripe" : "Connected-account review in progress"}</p><dl className="provider-facts"><div><dt>Connected account</dt><dd>acct_…{affiliate.id.slice(-4)}</dd></div><div><dt>Transfer capability</dt><dd>{affiliate.providerState === "ready" ? "Active" : "Blocked"}</dd></div><div><dt>Requirements</dt><dd>{affiliate.providerState === "needs_information" ? "Bank information" : affiliate.providerState === "ready" ? "None due" : "Provider review"}</dd></div><div><dt>Payout status</dt><dd>{affiliate.providerState === "ready" ? "Enabled" : "Restricted"}</dd></div></dl></div>
          <div className="provider-actions"><button className="secondary" onClick={onRefresh}><RefreshCw size={16} /> Refresh Stripe status</button>{affiliate.providerState === "needs_information" && <button className="primary" onClick={onReminder}><Send size={16} /> Send payout reminder</button>}</div>
        </section>

        <section className="invitation-line" data-moment>
          <div><Mail size={21} /><span><strong>Campaign invitation · {invitationCopy(affiliate.invitation)}</strong><small>{affiliate.invitationSentAt ?? "Not sent"}</small></span></div>
          <button className="secondary" onClick={() => onModal("invitation")}>{["sent", "delivered", "opened", "signup_started", "delivery_failed"].includes(affiliate.invitation) ? "Review invitation delivery & controls" : affiliate.invitation === "draft" ? "Send campaign invitation" : "View invitation receipt"} <ArrowRight size={16} /></button>
        </section>

        <section className="profile-section" data-moment>
          <header className="profile-section-head"><div><span className="provenance provenance-admin">Account support</span><h3>Recovery, notifications & retention</h3></div></header>
          <dl className="fact-grid"><div><dt>Password recovery</dt><dd>Email-link recovery · transactional</dd></div><div><dt>Notification history</dt><dd>Durable · transactional messages cannot be opted out</dd></div><div><dt>Eligible digest</dt><dd>{affiliate.notificationsDigest ? "Enabled" : "Not enabled"}</dd></div><div><dt>Deletion request</dt><dd>{affiliate.deletionState === "retention_review" ? "Retention review open" : "None"}</dd></div><div className="wide-fact"><dt>Retention</dt><dd>Account, tax and status records · account life plus seven years</dd></div></dl>
          <div className="context-actions"><button className="secondary" onClick={() => onModal("password_recovery")}><Mail size={16} /> Send password recovery link</button><button className="tertiary" onClick={() => onModal("deletion_request")}><FileText size={16} /> Record deletion request</button></div>
        </section>
      </div>
    </main>
  );
}

function CampaignView({ affiliate, campaign, section, onSection, onBack, onProfile, onReview, onCopy, onControls, onModal, onReminder, onRefresh }: {
  affiliate: Affiliate;
  campaign: CampaignRelationship;
  section: CampaignSection;
  onSection: (section: CampaignSection) => void;
  onBack: () => void;
  onProfile: () => void;
  onReview: () => void;
  onCopy: () => void;
  onControls: () => void;
  onModal: (type: ModalType, context?: Partial<ModalState>) => void;
  onReminder: () => void;
  onRefresh: () => void;
}) {
  const labels: Record<CampaignSection, string> = { overview: "Overview", agreement: "Agreement", content: "Content", money: "Money" };
  return (
    <main className="focused-page">
      <ContextHeader eyebrow={`${campaign.type} · ${affiliate.name} · Campaign relationship`} title={campaign.name} onBack={onBack} backLabel={`Back to ${affiliate.name}`} />
      <section className="campaign-state" data-moment>
        <div><span className="campaign-badge">{campaign.type}</span><h2>{campaign.stateLabel}</h2><p>Owner · {campaign.owner}</p></div>
        <dl><div><dt>Activated</dt><dd>{campaign.activated}</dd></div><div><dt>Closes</dt><dd>{campaign.closes}</dd></div><div><dt>Designation</dt><dd>{campaign.designation}</dd></div>{campaign.agreementState === "proposal_pending" && <div><dt>Formal response deadline</dt><dd>Tomorrow · fixed 72-hour window</dd></div>}</dl>
      </section>
      <div className="campaign-shell">
        <nav className="campaign-tabs" aria-label="Campaign relationship sections">
          {(Object.keys(labels) as CampaignSection[]).map((key) => <button key={key} className={section === key ? "active" : ""} onClick={() => onSection(key)}>{labels[key]}{key === "content" && campaign.postState === "submitted" && <span>1</span>}</button>)}
        </nav>
        <div className="campaign-content">
          {section === "overview" && <CampaignOverview affiliate={affiliate} campaign={campaign} onProfile={onProfile} onReview={onReview} onCopy={onCopy} onModal={onModal} />}
          {section === "agreement" && <AgreementSection campaign={campaign} onModal={onModal} />}
          {section === "content" && <ContentSection campaign={campaign} onReview={onReview} onModal={onModal} />}
          {section === "money" && <MoneySection affiliate={affiliate} campaign={campaign} onModal={onModal} onReminder={onReminder} onRefresh={onRefresh} />}
        </div>
      </div>
      <button className="floating-controls" onClick={onControls}><ShieldAlert size={16} /> Open relationship controls</button>
    </main>
  );
}

function CampaignOverview({ affiliate, campaign, onProfile, onReview, onCopy, onModal }: {
  affiliate: Affiliate;
  campaign: CampaignRelationship;
  onProfile: () => void;
  onReview: () => void;
  onCopy: () => void;
  onModal: (type: ModalType, context?: Partial<ModalState>) => void;
}) {
  return (
    <div className="section-stack">
      {campaign.postState === "submitted" && <ObjectTask owner="Admin" title="First post submitted" meta={`${campaign.postVersions.at(-1)?.url} · ${campaign.postVersions.at(-1)?.submittedAt}`} action="Review submitted post" onAction={onReview} />}
      {campaign.postState === "edits_requested" && <WaitingState owner="Affiliate" title="Post edits requested" meta="Affiliate link paused · corrected public URL required" action="Record corrected post URL" onAction={() => onModal("post_resubmission")} />}
      {campaign.agreementState === "proposal_pending" && <WaitingState owner="Founder" title="Proposal revision waiting" meta="Bilateral decision remains with Founder and Affiliate" action="Review commercial proposal" onAction={() => onModal("proposal_review")} />}
      {campaign.completion === "review_due" && <ObjectTask owner="Admin" title="Completion decision ready" meta="Deliverables, availability and money records are resolved" action="Review successful completion" onAction={() => onModal("completion")} />}
      {affiliate.verification !== "verified" && <ObjectTask owner="Admin" title="Creator readiness blocked" meta={`${verificationCopy(affiliate.verification)} · ${affiliate.evidence.length} evidence records`} action="Review verification evidence" onAction={onProfile} />}

      <section className="plain-section" data-moment>
        <header className="plain-head"><div><p className="eyebrow">Affiliate link</p><h3>{linkCopy(campaign.linkState)}</h3></div><div className="link-actions"><button className="secondary" onClick={onCopy}><Copy size={16} /> Copy Affiliate link</button><button className="tertiary" onClick={() => onModal("link_controls")}><Link2 size={16} /> Affiliate link history & controls</button></div></header>
        <div className="copy-object"><span>{campaign.trackingLink}</span>{campaign.trackingLink.startsWith("http") && <a href={campaign.trackingLink} target="_blank" rel="noreferrer" data-press>Open Affiliate link <ExternalLink size={15} /></a>}</div>
      </section>

      <section className="plain-section" data-moment>
        <header className="plain-head"><div><p className="eyebrow">Creator readiness</p><h3>{campaign.state === "active" ? "Cleared before launch" : campaign.stateLabel}</h3></div><div className="link-actions"><span className="status-inline"><Check size={16} /> {campaign.state === "active" ? "12 of 12" : "Current state"}</span><button className="secondary" onClick={() => onModal("readiness")}>View complete readiness checklist</button><button className="tertiary" onClick={() => onModal("relationship_fields")}>Edit campaign relationship data</button></div></header>
        <div className="readiness-line"><span>Campaign review</span><span>Accepted terms</span><span>Fixed funding</span><span>Stripe connection</span><span>Tracking disclosure</span><span>Proovd visuals</span></div>
      </section>

      <section className="plain-section kit-summary" data-moment>
        <header className="plain-head"><div><p className="eyebrow">Campaign kit</p><h3>{campaign.kitAssets.length} Proovd-provided visuals</h3></div><button className="secondary" onClick={() => onModal("campaign_kit")}><FileText size={16} /> Open visual Campaign kit</button></header>
        <dl className="fact-grid"><div><dt>Provider</dt><dd>Proovd</dd></div><div><dt>Version</dt><dd>{campaign.kitVersion}</dd></div><div><dt>Access</dt><dd>Private · campaign-scoped</dd></div><div><dt>Contents</dt><dd>Approved visual assets</dd></div></dl>
      </section>
    </div>
  );
}

function campaignTermsAreLocked(campaign: CampaignRelationship) {
  return campaign.termsLocked || ["active", "closed_reconciling", "closed_resolved", "suspended", "creator_replacement"].includes(campaign.state);
}

function campaignAgreementAccepted(campaign: CampaignRelationship) {
  return campaign.agreementState === "accepted";
}

function AgreementSection({ campaign, onModal }: { campaign: CampaignRelationship; onModal: (type: ModalType) => void }) {
  const termsLocked = campaignTermsAreLocked(campaign);
  const agreementAccepted = campaignAgreementAccepted(campaign);
  const upfrontFeeAvailable = campaign.type === "Product Campaign";
  const upfrontFeeRequested = upfrontFeeAvailable && campaign.fixedPayment !== "Not requested";
  const agreementLabel = termsLocked ? "Locked at launch · version 3" : agreementAccepted ? "Accepted · locks at launch" : campaign.agreementState === "proposal_pending" ? "Current proposal · version 2" : "No accepted version";
  const upfrontFeeStatus = !upfrontFeeAvailable ? "Not available" : !upfrontFeeRequested ? termsLocked ? "Locked · not requested" : "Not requested" : termsLocked ? "Locked" : agreementAccepted ? "Accepted · locks at launch" : "Not accepted";
  const currentVersion = termsLocked ? "Version 3 · locked at campaign launch" : agreementAccepted ? "Version 3 · both parties accepted" : campaign.agreementState === "proposal_pending" ? "Version 2 · Founder response due" : "No accepted version";
  const upfrontFeeSource = !upfrontFeeAvailable ? "Campaign type rule" : upfrontFeeRequested ? "Affiliate proposal" : "None";
  const upfrontFeeRule = upfrontFeeAvailable ? "Optional · Product Campaigns only" : "Upfront fees are unavailable for Idea Campaigns";
  return (
    <div className="section-stack">
      {campaign.agreementState === "proposal_pending" && <ObjectTask owner="Founder" title="Proposal revision 2" meta={`${campaign.compensation} · ${campaign.fixedPayment}`} action="Review commercial proposal" onAction={() => onModal("proposal_review")} />}
      <section className="agreement-hero" data-moment><p className="eyebrow">{agreementLabel}</p><h2>{campaign.compensation.split(" ")[0]} <span>{campaign.compensation.split(" ").slice(1).join(" ")}</span></h2><p>{campaign.bonus}</p></section>
      <section className="plain-section" data-moment><header className="plain-head"><div><p className="eyebrow">Upfront fee</p><h3>{campaign.fixedPayment}</h3></div><span className="status-inline">{termsLocked ? <LockKeyhole size={16} /> : <Check size={16} />} {upfrontFeeStatus}</span></header><dl className="fact-grid"><div><dt>Source</dt><dd>{upfrontFeeSource}</dd></div><div><dt>Current version</dt><dd>{currentVersion}</dd></div><div><dt>Funding</dt><dd>{upfrontFeeRequested ? campaign.fixedPayment : "Not applicable"}</dd></div><div><dt>Rule</dt><dd>{upfrontFeeRule}</dd></div></dl>{upfrontFeeAvailable && <><div className="fixed-state-chain" aria-label="Upfront fee states"><span>Not requested</span><span>Awaiting agreement</span><span>Payment pending</span><span>Funded</span><span>Payment failed</span><span>Returned</span><span>Paid</span></div><p className="money-truth">Funded means the campaign-specific upfront fee was funded. It does not mean the Creator was paid.</p></>}</section>
      <section className="plain-section" data-moment><header className="plain-head"><div><p className="eyebrow">Commercial record</p><h3>Immutable proposal versions</h3></div><button className="secondary" onClick={() => onModal("agreement_history")}><FileCheck2 size={16} /> View agreement version history</button></header><div className="acceptance-line"><span><Check /> Affiliate proposal preserved</span><span><Check /> Founder response preserved</span><span><Check /> Exact bilateral acceptance required</span></div></section>
    </div>
  );
}

function ContentSection({ campaign, onReview, onModal }: {
  campaign: CampaignRelationship;
  onReview: () => void;
  onModal: (type: ModalType, context?: Partial<ModalState>) => void;
}) {
  const latest = campaign.postVersions.at(-1);
  return (
    <div className="section-stack">
      {latest ? (
        <section className={`submission-object submission-${campaign.postState}`} data-moment>
          <div><p className="eyebrow">Public post · version {latest.version}</p><h3>{postCopy(campaign.postState)}</h3><a href={latest.url} target="_blank" rel="noreferrer" data-press>{latest.url} <ExternalLink size={15} /></a><small>{latest.submittedAt} · {latest.status}</small></div>
          <div className="submission-actions">{campaign.postState === "submitted" && <button className="primary" onClick={onReview}>Review submitted post <ArrowRight size={17} /></button>}{campaign.postState === "edits_requested" && <button className="primary" onClick={() => onModal("post_resubmission")}>Record corrected post URL <Plus size={17} /></button>}<button className="secondary" onClick={() => onModal("post_history")}>View submission history</button></div>
        </section>
      ) : <WaitingState owner={campaign.owner} title="No public post submitted" meta="Work cannot begin until Creator readiness is cleared" />}

      <section className="plain-section" data-moment>
        <header className="plain-head"><div><p className="eyebrow">Deliverables</p><h3>{campaign.deliverables.filter((item) => item.state === "verified" || item.state === "waived").length} of {campaign.deliverables.length} resolved</h3></div></header>
        <div className="deliverable-list">
          {campaign.deliverables.map((item) => <article key={item.id}><span className={`deliverable-icon deliverable-${item.state}`}>{item.state === "verified" || item.state === "waived" ? <Check size={17} /> : item.state === "submitted" ? <Paperclip size={17} /> : <Clock3 size={17} />}</span><span><strong>{item.title}</strong><small>{deliverableCopy(item.state)}</small>{item.proofUrl && <a href={item.proofUrl} target="_blank" rel="noreferrer" data-press>View submitted proof <ExternalLink size={13} /></a>}</span>{item.state === "submitted" || item.state === "needs_evidence" ? <button className="secondary" onClick={() => onModal("deliverable_review", { deliverableId: item.id })}>Review deliverable evidence</button> : <span className="quiet-state">{deliverableCopy(item.state)}</span>}</article>)}
        </div>
      </section>

      <section className="availability-line" data-moment><div><ClipboardCheck size={22} /><span><strong>{campaign.availabilityVerified ? "Availability period verified" : "Availability period not verified"}</strong><small>{campaign.availabilityTerm}</small></span></div>{campaign.availabilityVerified ? <span className="status-inline"><Check size={16} /> Verified</span> : <button className="secondary" onClick={() => onModal("availability_review")}>Verify content availability</button>}</section>

      <section className="performance-strip" data-moment><div><span>Clicks</span><strong>{campaign.earningsAmount ? "418" : "0"}</strong></div><div><span>Attributed pre-orders</span><strong>{campaign.earningsAmount ? "11" : "0"}</strong></div><div><span>Captured attributed Backers</span><strong>{campaign.earningsAmount ? "8" : "0"}</strong></div><div><span>Conversion</span><strong>{campaign.earningsAmount ? "2.6%" : "—"}</strong></div><div><span>Attributed captured pre-tax subtotal</span><strong>{campaign.earningsAmount ? "$1,430" : "$0"}</strong></div><div><span>Freshness</span><strong>11:30 AM</strong></div><p>Refresh-based · provisional until capture and reconciliation · last valid Creator click on the same browser/device wins · no Backer PII.</p></section>
    </div>
  );
}

function MoneySection({ affiliate, campaign, onModal, onReminder, onRefresh }: {
  affiliate: Affiliate;
  campaign: CampaignRelationship;
  onModal: (type: ModalType) => void;
  onReminder: () => void;
  onRefresh: () => void;
}) {
  const canTransfer = campaign.earningsStatus === "finalized" || campaign.earningsStatus === "approved for transfer";
  const canDecideUpfrontFee = campaign.type === "Product Campaign" && campaign.fixedPayment !== "Not requested";
  return (
    <div className="section-stack">
      <section className="money-hero" data-moment><p className="eyebrow">{earningsCopy(campaign.earningsStatus)}</p><h2>${campaign.earningsAmount.toFixed(2)}</h2><p>{moneyOwner(campaign, affiliate)}</p></section>
      {affiliate.providerState === "needs_information" && <ObjectTask owner="Affiliate" title="Bank information required" meta="Stripe payout failed · Affiliate must update the provider" action="Send payout reminder" onAction={onReminder} />}
      {canTransfer && <ObjectTask owner="Admin" title="Affiliate Transfer ready" meta={`$${campaign.earningsAmount.toFixed(2)} · finalized commission, bonus and upfront-fee eligibility`} action="Create Affiliate Transfer" onAction={() => onModal("transfer")} />}
      <section className="plain-section" data-moment><header className="plain-head"><div><p className="eyebrow">Campaign earnings</p><h3>{earningsCopy(campaign.earningsStatus)}</h3></div><button className="tertiary" onClick={() => onModal("earnings_adjustment")}>Review or adjust earnings</button></header><dl className="money-grid"><div><dt>Attributed captured subtotal</dt><dd>${campaign.earningsAmount ? "1,430.00" : "0.00"}</dd></div><div><dt>Percentage compensation</dt><dd>${campaign.earningsAmount.toFixed(2)}</dd></div><div><dt>Creator-specific bonus</dt><dd>{campaign.bonus}</dd></div><div><dt>Upfront fee</dt><dd>{campaign.fixedPayment}</dd></div><div><dt>Tax in earnings base</dt><dd>$0.00</dd></div><div><dt>Current status</dt><dd>{earningsCopy(campaign.earningsStatus)}</dd></div></dl><div className="money-state-chain" aria-label="Affiliate money lifecycle"><span>Estimated</span><span>Finalized</span><span>Approved</span><span>Transferred</span><span>Paid</span><span>Failed</span><span>Adjusted</span><span>Reversed / recovery</span></div><div className="context-actions">{canDecideUpfrontFee && <button className="secondary" onClick={() => onModal("fixed_decision")}>Decide upfront fee outcome</button>}{campaign.completion === "review_due" && <button className="primary" onClick={() => onModal("completion")}>Review successful completion</button>}</div></section>
      <section className={`provider-strip provider-${affiliate.providerState}`} data-moment><div><span className="provenance provenance-provider">Stripe supplied</span><h3>{providerCopy(affiliate.providerState)}</h3><p>Provider identity and bank facts cannot be edited in Proovd.</p></div><div className="provider-actions"><button className="secondary" onClick={onRefresh}><RefreshCw size={16} /> Refresh Stripe status</button>{affiliate.providerState === "needs_information" && <button className="primary" onClick={onReminder}><Send size={16} /> Send payout reminder</button>}</div></section>
      {campaign.completion === "successful" && campaign.workAgain !== "none" && <section className="work-again-line" data-moment><div><BriefcaseBusiness size={21} /><span><strong>Work-again request · {campaign.workAgain}</strong><small>Founder and Affiliate own the decision · no campaign is created</small></span></div><button className="secondary" onClick={() => onModal("work_again")}>Review work-again request</button></section>}
    </div>
  );
}

function PostReview({ affiliate, campaign, step, checks, allChecksPass, onToggle, onStep, onBack, onApprove, onRequestEdits, onReject, onEscalate, onHistory }: {
  affiliate: Affiliate;
  campaign: CampaignRelationship;
  step: "review" | "edits";
  checks: Record<CheckId, boolean>;
  allChecksPass: boolean;
  onToggle: (id: CheckId) => void;
  onStep: (step: "review" | "edits") => void;
  onBack: () => void;
  onApprove: () => void;
  onRequestEdits: (note: string, due: string) => void;
  onReject: () => void;
  onEscalate: () => void;
  onHistory: () => void;
}) {
  const latest = campaign.postVersions.at(-1);
  if (!latest) return null;
  if (step === "edits") return <EditRequest affiliate={affiliate} campaign={campaign} checks={checks} onBack={onBack} onSend={onRequestEdits} />;
  return (
    <main className="focused-page review-page">
      <ContextHeader eyebrow={`${affiliate.name} · ${campaign.name}`} title="Review submitted post" onBack={onBack} backLabel="Back to campaign content" />
      <div className="review-layout">
        <section className="review-evidence" data-moment>
          <div className="review-question"><p className="eyebrow">Version {latest.version} · {latest.submittedAt}</p><h2>Does this public post meet the locked terms?</h2></div>
          <a className="public-url" href={latest.url} target="_blank" rel="noreferrer" data-press><span>Open live public post</span><strong>{latest.url}</strong><ExternalLink size={19} /></a>
          <article className="instagram-preview"><header><div className="mini-avatar">{affiliate.initials}</div><div><strong>{affiliate.handle.replace("@", "")}</strong><small>{affiliate.platform} · public</small></div><span>#ad</span></header><div className="preview-visual"><div className="teeb-sticker">T</div><p>Your voice notes,<br />ready to study.</p></div><p><strong>{affiliate.handle.replace("@", "")}</strong> #ad I’ve been testing Teeb, a new study tool that turns voice notes into shareable study guides. It’s an early product with October delivery.</p><footer>Public URL version {latest.version} · every corrected version remains in history</footer></article>
          <button className="secondary full-button" onClick={onHistory}>View every submitted version</button>
        </section>
        <aside className="review-decision" data-moment>
          <div className="approved-context"><p className="eyebrow">Locked campaign requirements</p><dl><div><dt>Work</dt><dd>Launch post</dd></div><div><dt>Disclosure</dt><dd>Paid relationship with Teeb</dd></div><div><dt>Allowed claim</dt><dd>Voice notes → study guides</dd></div><div><dt>Delivery</dt><dd>October 2026</dd></div></dl></div>
          <div className="review-checks">{REVIEW_CHECKS.map((item) => <button key={item.id} className={checks[item.id] ? "checked" : ""} onClick={() => onToggle(item.id)} aria-pressed={checks[item.id]}><span>{checks[item.id] && <Check size={15} />}</span>{item.label}</button>)}</div>
          <div className="review-actions"><button className="primary" disabled={!allChecksPass} onClick={onApprove}>Approve submitted post <Check size={18} /></button><button className="secondary" onClick={() => onStep("edits")}>Request post edits</button><button className="tertiary danger" onClick={onReject}>Reject submitted post</button><button className="tertiary danger" onClick={onEscalate}>Escalate serious issue</button><p>First-post review releases $0.</p></div>
        </aside>
      </div>
    </main>
  );
}

function EditRequest({ affiliate, campaign, checks, onBack, onSend }: { affiliate: Affiliate; campaign: CampaignRelationship; checks: Record<CheckId, boolean>; onBack: () => void; onSend: (note: string, due: string) => void }) {
  const failed = REVIEW_CHECKS.filter((item) => !checks[item.id]);
  const [note, setNote] = useState(failed.length ? `Correct: ${failed.map((item) => item.label.toLowerCase()).join("; ")}.` : "Move the paid-partnership disclosure to the beginning so it is hard to miss.");
  const [due, setDue] = useState("Today · 4:00 PM EDT");
  return (
    <main className="focused-page">
      <ContextHeader eyebrow={`${affiliate.name} · ${campaign.name} · Step 2 of 2`} title="Request post edits" onBack={onBack} backLabel="Back to post review" />
      <form className="review-flow correction-flow" onSubmit={(event) => { event.preventDefault(); onSend(note, due); }}>
        <section data-moment><p className="eyebrow">Failed checks</p><h2>{failed.length || 1} item{failed.length === 1 ? "" : "s"} to correct</h2><div className="failed-checks">{(failed.length ? failed : [REVIEW_CHECKS[2]]).map((item) => <span key={item.id}><X size={15} /> {item.label}</span>)}</div></section>
        <section className="correction-form" data-moment><label htmlFor="correction-text">Affiliate-facing correction<textarea id="correction-text" value={note} onChange={(event) => setNote(event.target.value)} required /></label><label htmlFor="correction-due">Correction due<select id="correction-due" value={due} onChange={(event) => setDue(event.target.value)}><option>Today · 4:00 PM EDT</option><option>Tomorrow · 12:00 PM EDT</option><option>Aug 13 · 5:00 PM EDT</option></select></label><div className="consequence-note"><Link2 size={18} /><span><strong>Affiliate link pauses when sent</strong><small>New traffic is not payable until a corrected post passes.</small></span></div><button className="primary" type="submit">Send post edit request <ArrowRight size={18} /></button></section>
      </form>
    </main>
  );
}

function ControlsView({ affiliate, campaign, onBack, onModal, onHistory }: {
  affiliate: Affiliate;
  campaign: CampaignRelationship | null;
  onBack: () => void;
  onModal: (type: ModalType, caseId?: string) => void;
  onHistory: () => void;
}) {
  const openCases = affiliate.cases.filter((item) => item.status === "open");
  return (
    <main className="focused-page">
      <ContextHeader eyebrow={`${affiliate.name} · Account level`} title="Policy, cases & access" onBack={onBack} backLabel={`Back to ${affiliate.name}`} />
      <div className="focused-wrap controls-wrap">
        {openCases.length ? <section className="case-focus" data-moment><p className="eyebrow">Open cases</p><h2>{openCases.length} decision{openCases.length === 1 ? "" : "s"}</h2><div className="case-list">{openCases.map((item) => <article key={item.id}><span><strong>{item.title}</strong><small>{item.detail} · {item.due}</small></span><button className="primary" onClick={() => onModal("review_case", item.id)}>Review {caseActionNoun(item.kind)} <ArrowRight size={16} /></button></article>)}</div></section> : <section className="status-banner" data-moment><ShieldCheck size={28} /><div><h2>{affiliate.accountState === "eligible" ? "Account eligible" : "Account suspended"}</h2><p>{affiliate.accountState === "eligible" ? "No open compliance or enforcement case." : "Access and active Affiliate links are paused."}</p></div></section>}

        <section className="controls-group" data-moment><header><p className="eyebrow">Case intake</p><h2>Compliance & support cases</h2></header><button className="secondary" onClick={() => onModal("record_case")}><Plus size={17} /> Record a compliance or support case</button></section>

        <section className="controls-group split-controls" data-moment>
          <header><p className="eyebrow">Account access</p><h2>{affiliate.accountState === "eligible" ? "Eligible" : "Suspended"}</h2></header>
          <div className="control-list">
            <button onClick={() => onModal("warning")}><span><strong>Issue Affiliate warning</strong><small>Record rule, evidence, correction and appeal route</small></span><ChevronRight /></button>
            {affiliate.accountState === "eligible" ? <button onClick={() => onModal("suspend")}><span><strong>Suspend Affiliate account</strong><small>Pause access and active Affiliate links</small></span><ChevronRight /></button> : <button onClick={() => onModal("restore")}><span><strong>Restore Affiliate account</strong><small>Re-enable access after the recorded resolution</small></span><ChevronRight /></button>}
            <button onClick={() => onModal("access_decision")}><span><strong>Change internal tier or proposal access</strong><small>Admin-owned classification and policy access</small></span><ChevronRight /></button>
            <button onClick={() => onModal("policy_reacceptance")}><span><strong>{affiliate.policyState === "reacceptance_required" ? "Reissue policy acceptance request" : "Require current policy reacceptance"}</strong><small>Pause continued use until the Affiliate accepts the material update</small></span><ChevronRight /></button>
          </div>
        </section>

        {campaign && <section className="controls-group split-controls destructive-zone" data-moment><header><p className="eyebrow">Campaign relationship</p><h2>{campaign.name}</h2></header><div className="control-list"><button onClick={() => onModal("remove")}><span><strong>Remove Affiliate from campaign</strong><small>Stop the relationship and Affiliate link; money follows cause rules</small></span><ChevronRight /></button><button onClick={() => onModal("campaign_suspend")}><span><strong>Suspend campaign</strong><small>Pause campaign activity and Affiliate links while evidence and support remain available</small></span><ChevronRight /></button><button onClick={() => onModal("campaign_kill")}><span><strong>Kill campaign</strong><small>Stop live activity and open the required refund, reversal or recovery path</small></span><ChevronRight /></button></div></section>}

        <section className="history-entry" data-moment><div><History size={20} /><span><strong>Policy and account history</strong><small>Warnings, disclosures, appeals, access changes and corrections</small></span></div><button className="secondary" onClick={onHistory}>View policy history <ArrowRight size={16} /></button></section>
      </div>
    </main>
  );
}

function HistoryView({ affiliate, filter, onFilter, onBack }: { affiliate: Affiliate; filter: EventCategory | "all"; onFilter: (filter: EventCategory | "all") => void; onBack: () => void }) {
  const events = affiliate.events.filter((item) => filter === "all" || item.category === filter);
  const labels: Record<EventCategory | "all", string> = { all: "All events", account: "Account", campaign: "Campaign", evidence: "Evidence", money: "Money", policy: "Policy" };
  return (
    <main className="focused-page">
      <ContextHeader eyebrow={`${affiliate.name} · Read only`} title="History" onBack={onBack} backLabel={`Back to ${affiliate.name}`} />
      <div className="focused-wrap history-wrap">
        <section className="history-gist" data-moment><p className="eyebrow">Audit record</p><h2>{affiliate.events.length} events</h2><div className="history-filters">{(Object.keys(labels) as (EventCategory | "all")[]).map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => onFilter(item)}>{labels[item]}</button>)}</div></section>
        <ol className="timeline" data-moment>{events.map((item) => <li key={item.id}><time>{item.time}</time><div><span className="history-category">{labels[item.category]}</span><strong>{item.title}</strong><p>{item.detail}</p><small>Actor · {item.actor} · immutable event {item.id}</small></div></li>)}</ol>
      </div>
    </main>
  );
}

function ModalRouter({ modal, affiliate, campaign, onClose, onAction }: { modal: ModalState; affiliate: Affiliate | null; campaign: CampaignRelationship | null; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  if (modal.type === "recruit") return <RecruitModal onClose={onClose} onAction={onAction} />;
  if (modal.type === "admin_account") return <SimpleModal title="Admin account" onClose={onClose}><div className="admin-account-block"><span className="admin-account-monogram">JL</span><div><h3>Jordan Lee</h3><p>Affiliate operations · MFA active</p></div></div><dl className="modal-facts"><div><dt>Recent reauthentication</dt><dd>9:02 AM</dd></div><div><dt>Money authority</dt><dd>Enabled</dd></div><div><dt>Live Affiliate payments</dt><dd>Pilot gate enabled · monitoring owner recorded</dd></div><div><dt>Affiliate AUP review</dt><dd>Quarterly review due Sep 30, 2026</dd></div><div><dt>Provider test evidence</dt><dd>Recipient, duplicate and negative-event scenarios passed</dd></div><div><dt>Access</dt><dd>Owner-only workspace</dd></div></dl><button className="secondary full-button" onClick={onClose}>Close Admin account</button></SimpleModal>;
  if (!affiliate) return null;

  if (modal.type === "research") return <ResearchModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "account_correction") return <AccountCorrectionModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "profile_correction") return <ProfileCorrectionModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "evidence") {
    const asset = affiliate.evidence.find((item) => item.id === modal.evidenceId);
    if (!asset) return null;
    return <SimpleModal title={asset.name} onClose={onClose} wide><EvidenceViewer asset={asset} affiliate={affiliate} /><dl className="modal-facts">{asset.category && <div><dt>Research item</dt><dd>{asset.category}</dd></div>}<div><dt>Source</dt><dd>{asset.source} supplied</dd></div><div><dt>Channel</dt><dd>{affiliate.handle}</dd></div><div><dt>Uploaded</dt><dd>{asset.uploadedAt}</dd></div><div><dt>Decision</dt><dd>{verificationCopy(affiliate.verification)}</dd></div></dl></SimpleModal>;
  }
  if (modal.type === "upload_evidence") return <UploadEvidenceModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "verify_evidence") return <VerifyEvidenceModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "request_evidence") return <RequestEvidenceModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "invitation") return <InvitationModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "assign_campaign") return <AssignCampaignModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (!campaign && !["record_case", "warning", "suspend", "restore", "access_decision", "review_case", "policy_reacceptance", "password_recovery", "deletion_request"].includes(modal.type)) return null;

  if (modal.type === "campaign_kit" && campaign) return <CampaignKitModal campaign={campaign} onClose={onClose} />;
  if (modal.type === "relationship_fields" && campaign) return <RelationshipFieldsModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "agreement_history" && campaign) return <AgreementHistoryModal campaign={campaign} onClose={onClose} />;
  if (modal.type === "proposal_review" && campaign) return <ProposalModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "link_controls" && campaign) return <LinkControlsModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "post_history" && campaign) return <PostHistoryModal campaign={campaign} onClose={onClose} />;
  if (modal.type === "post_resubmission" && campaign) return <PostResubmissionModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if ((modal.type === "post_reject" || modal.type === "post_escalate") && campaign) return <PostDecisionModal mode={modal.type} campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "deliverable_review" && campaign) {
    const deliverable = campaign.deliverables.find((item) => item.id === modal.deliverableId);
    if (!deliverable) return null;
    return <DeliverableModal deliverable={deliverable} onClose={onClose} onAction={onAction} />;
  }
  if (modal.type === "availability_review" && campaign) return <AvailabilityModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "payout_reminder") return <ConfirmModal title="Send payout reminder" fact={`${affiliate.name} · ${providerCopy(affiliate.providerState)}`} consequence="The email opens Stripe’s managed update path. Proovd does not collect or edit bank information." action="Send payout reminder" onClose={onClose} onConfirm={() => onAction("payout_reminder")} />;
  if (modal.type === "transfer" && campaign) return <TransferModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "earnings_adjustment" && campaign) return <EarningsAdjustmentModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "fixed_decision" && campaign) return <FixedDecisionModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "completion" && campaign) return <CompletionModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "work_again" && campaign) return <WorkAgainModal campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "record_case") return <RecordCaseModal onClose={onClose} onAction={onAction} />;
  if (modal.type === "review_case") {
    const supportCase = affiliate.cases.find((item) => item.id === modal.caseId);
    if (!supportCase) return null;
    return <ReviewCaseModal supportCase={supportCase} onClose={onClose} onAction={onAction} />;
  }
  if (modal.type === "warning") return <EnforcementModal mode="warning" affiliate={affiliate} campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "suspend") return <EnforcementModal mode="suspend" affiliate={affiliate} campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "restore") return <RestoreModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "remove" && campaign) return <RemoveModal affiliate={affiliate} campaign={campaign} onClose={onClose} onAction={onAction} />;
  if ((modal.type === "campaign_suspend" || modal.type === "campaign_kill") && campaign) return <CampaignRiskModal mode={modal.type} campaign={campaign} onClose={onClose} onAction={onAction} />;
  if (modal.type === "access_decision") return <AccessDecisionModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "policy_reacceptance") return <PolicyReacceptanceModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  if (modal.type === "readiness" && campaign) return <ReadinessModal affiliate={affiliate} campaign={campaign} onClose={onClose} />;
  if (modal.type === "password_recovery") return <ConfirmModal title="Send password recovery link" fact={`${affiliate.name} · ${affiliate.email}`} consequence="The link is transactional, rate-limited and non-enumerating. No credential value appears in history." action="Send password recovery link" onClose={onClose} onConfirm={() => onAction("password_recovery")} />;
  if (modal.type === "deletion_request") return <DeletionRequestModal affiliate={affiliate} onClose={onClose} onAction={onAction} />;
  return null;
}

function RecruitModal({ onClose, onAction }: { onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [researchPictures, setResearchPictures] = useState<ResearchPictureFiles>(emptyResearchPictures);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", handle: "", channelUrl: "", platform: "Instagram", subtype: "Social Creator", niche: "", tier: "Tier B", audienceSize: "", engagementRate: "", demographics: "", subtypeMetrics: "", channelPermission: "", sponsoredHistory: "", promotionPlan: "", similarCampaignPerformance: "", adminBio: "", source: "Admin research", notes: "", conflicts: "", redFlags: "", sanctionsNotes: "", campaignName: "Teeb Founding Launch", founder: "Teeb Labs LLC", campaignType: "Product Campaign" as CampaignRelationship["type"], designation: "Initial launch roster" as CampaignRelationship["designation"], remainingTime: "Initial roster · full campaign window" });
  function field(name: keyof typeof draft, value: string) { setDraft((current) => ({ ...current, [name]: value })); }
  function chooseCampaign(campaignName: string) {
    const selectedCampaignChoice = CAMPAIGN_CHOICES.find((campaignChoice) => campaignChoice.name === campaignName);
    setDraft((current) => ({ ...current, campaignName, founder: selectedCampaignChoice?.founder ?? current.founder, campaignType: (selectedCampaignChoice?.type ?? current.campaignType) as CampaignRelationship["type"] }));
  }
  function addPictures(key: ResearchPictureKey, incoming: File[]) {
    setResearchPictures((current) => ({ ...current, [key]: [...current[key], ...incoming.filter((file) => file.type.startsWith("image/"))] }));
  }
  function removePicture(key: ResearchPictureKey, index: number) {
    setResearchPictures((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  }
  const pictureCount = Object.values(researchPictures).reduce((total, items) => total + items.length, 0);
  const canAdvance = step === 1 ? Boolean(draft.name && draft.email && draft.handle && draft.channelUrl && draft.niche) : step === 2 ? Boolean(draft.audienceSize && draft.demographics && draft.subtypeMetrics && draft.channelPermission) : step === 3 ? Boolean(draft.adminBio && draft.source) : Boolean(draft.campaignName && draft.founder);
  return <ModalShell title={`Add Affiliate · ${step} of 4`} onClose={onClose} wide><form className="modal-body add-affiliate-flow" onSubmit={(event) => { event.preventDefault(); if (step < 4) setStep((current) => current + 1); }}><div className="flow-progress" aria-label={`Step ${step} of 4`}><i style={{ transform: `scaleX(${step / 4})` }} /></div>
    {step === 1 && <><h3 className="modal-question">Who is the campaign prospect?</h3><div className="form-grid"><label>Name<input value={draft.name} onChange={(e) => field("name", e.target.value)} required /></label><label>Username<input value={draft.handle} onChange={(e) => field("handle", e.target.value)} placeholder="@username" required /></label><label>Email<input type="email" value={draft.email} onChange={(e) => field("email", e.target.value)} required /></label><label>Phone number · unverified<input type="tel" value={draft.phone} onChange={(e) => field("phone", e.target.value)} /></label><label>Public channel URL<input type="url" value={draft.channelUrl} onChange={(e) => field("channelUrl", e.target.value)} placeholder="https://…" required /></label><label>Channel<select value={draft.platform} onChange={(e) => field("platform", e.target.value)}><option>Instagram</option><option>TikTok</option><option>YouTube</option><option>Newsletter / blog</option><option>Podcast</option><option>Community</option><option>Course</option><option>Student network</option><option>Niche distribution</option></select></label><label>Affiliate subtype<select value={draft.subtype} onChange={(e) => field("subtype", e.target.value)}><option>Social Creator</option><option>Newsletter Operator</option><option>Podcast Host</option><option>Community Operator</option><option>Course Instructor</option><option>Student Affiliate</option><option>Niche Distribution Partner</option></select></label><label className="full-field">Niche / category<input value={draft.niche} onChange={(e) => field("niche", e.target.value)} required /></label></div></>}
    {step === 2 && <><h3 className="modal-question">What evidence supports the channel?</h3><div className="form-grid"><label>Audience size<input type="number" min="0" value={draft.audienceSize} onChange={(e) => field("audienceSize", e.target.value)} required /></label><label>Engagement / subtype rate (%)<input type="number" min="0" max="100" step="0.1" value={draft.engagementRate} onChange={(e) => field("engagementRate", e.target.value)} /></label><label className="full-field">Subtype-specific metrics<textarea value={draft.subtypeMetrics} onChange={(e) => field("subtypeMetrics", e.target.value)} placeholder="Followers + engagement; subscribers + CTR; listens; active members; enrolled students + ratings; or compliant traffic plan." required /></label><label className="full-field">Audience demographics<textarea value={draft.demographics} onChange={(e) => field("demographics", e.target.value)} placeholder="Geography, age or source-defined subtype context" required /></label><div className="full-field research-evidence-field"><label>Channel ownership / permission<textarea value={draft.channelPermission} onChange={(e) => field("channelPermission", e.target.value)} required /></label><ResearchPictureUpload id="recruit-channel-permission" files={researchPictures.channelPermission} onAdd={(items) => addPictures("channelPermission", items)} onRemove={(index) => removePicture("channelPermission", index)} /></div><div className="full-field research-evidence-field"><label>Sponsored-content history<textarea value={draft.sponsoredHistory} onChange={(e) => field("sponsoredHistory", e.target.value)} /></label><ResearchPictureUpload id="recruit-sponsored-history" files={researchPictures.sponsoredHistory} onAdd={(items) => addPictures("sponsoredHistory", items)} onRemove={(index) => removePicture("sponsoredHistory", index)} /></div><div className="full-field research-evidence-field"><label>Written promotion / traffic plan<textarea value={draft.promotionPlan} onChange={(e) => field("promotionPlan", e.target.value)} /></label><ResearchPictureUpload id="recruit-promotion-plan" files={researchPictures.promotionPlan} onAdd={(items) => addPictures("promotionPlan", items)} onRemove={(index) => removePicture("promotionPlan", index)} /></div><label className="full-field">Other verification evidence files<input type="file" multiple accept="image/*,.pdf,.csv,.xlsx" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><small>{files.length ? `${files.length} other evidence object${files.length === 1 ? "" : "s"} selected` : "Add uncategorized analytics exports or supporting documents here."}</small></label></div></>}
    {step === 3 && <><h3 className="modal-question">How does Admin assess quality and risk?</h3><div className="form-grid"><label>Internal quality tier<select value={draft.tier} onChange={(e) => field("tier", e.target.value)}><option>Tier A</option><option>Tier B</option><option>Tier C</option></select></label><label>Recruitment source<input value={draft.source} onChange={(e) => field("source", e.target.value)} required /></label><label className="full-field">Admin-written bio<textarea value={draft.adminBio} onChange={(e) => field("adminBio", e.target.value)} required /></label><div className="full-field research-evidence-field"><label>Similar-campaign performance<textarea value={draft.similarCampaignPerformance} onChange={(e) => field("similarCampaignPerformance", e.target.value)} /></label><ResearchPictureUpload id="recruit-similar-performance" files={researchPictures.similarCampaignPerformance} onAdd={(items) => addPictures("similarCampaignPerformance", items)} onRemove={(index) => removePicture("similarCampaignPerformance", index)} /></div><label className="full-field">Conflicts / relationships<textarea value={draft.conflicts} onChange={(e) => field("conflicts", e.target.value)} placeholder="Founder, Backer, Affiliate, competitor, advisor, investor, employee, family or financial relationships" /></label><label className="full-field">Red flags<textarea value={draft.redFlags} onChange={(e) => field("redFlags", e.target.value)} placeholder="Duplicate account, traffic manipulation, self-preorder or provider concern" /></label><label className="full-field">Sanctions / OFAC research note<textarea value={draft.sanctionsNotes} onChange={(e) => field("sanctionsNotes", e.target.value)} /></label><label className="full-field">Internal notes<textarea value={draft.notes} onChange={(e) => field("notes", e.target.value)} /></label></div></>}
    {step === 4 && <><h3 className="modal-question">Which campaign relationship is being created?</h3><div className="form-grid"><label>Campaign name<select value={draft.campaignName} onChange={(e) => chooseCampaign(e.target.value)} required>{CAMPAIGN_CHOICES.map((campaignChoice) => <option key={campaignChoice.name} value={campaignChoice.name}>{campaignChoice.name}</option>)}</select></label><label>Founder<select value={draft.founder} onChange={(e) => field("founder", e.target.value)} required>{FOUNDER_CHOICES.map((founder) => <option key={founder}>{founder}</option>)}</select></label><label>Campaign type<select value={draft.campaignType} onChange={(e) => field("campaignType", e.target.value)}><option>Product Campaign</option><option>Idea Campaign</option></select></label><label>Roster designation<select value={draft.designation} onChange={(e) => field("designation", e.target.value)}><option>Initial launch roster</option><option>Mid-campaign addition</option></select></label>{draft.designation === "Mid-campaign addition" && <label className="full-field">Exact remaining time and adjusted work<input value={draft.remainingTime} onChange={(e) => field("remainingTime", e.target.value)} required /></label>}</div><div className="summary-block"><strong>{draft.name || "Prospect"}</strong><span>{draft.handle} · {draft.subtype} · {Number(draft.audienceSize || 0).toLocaleString()} audience</span><span>{draft.campaignName} · {draft.campaignType} · {draft.designation}</span><span>{files.length + pictureCount} evidence object{files.length + pictureCount === 1 ? "" : "s"} · account will not be created</span></div><button className="primary" type="button" onClick={() => onAction("recruit", { ...draft, files, researchPictures, sendInvite: false })}>Save prospect</button><button className="secondary" type="button" onClick={() => onAction("recruit", { ...draft, files, researchPictures, sendInvite: true })}>Send campaign invitation</button></>}
    <div className="flow-controls">{step > 1 && <button className="tertiary" type="button" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={16} /> Back</button>}{step < 4 && <button className="primary" type="submit" disabled={!canAdvance}>Continue <ArrowRight size={17} /></button>}</div>
  </form></ModalShell>;
}

function ResearchModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [draft, setDraft] = useState({ handle: affiliate.handle, channelUrl: affiliate.channelUrl, subtype: affiliate.subtype, niche: affiliate.niche, tier: affiliate.tier, adminBio: affiliate.adminBio, source: affiliate.source, adminNotes: affiliate.adminNotes, audienceSize: String(affiliate.audienceSize), engagementRate: String(affiliate.engagementRate), demographics: affiliate.demographics, subtypeMetrics: affiliate.subtypeMetrics ?? "", channelPermission: affiliate.channelPermission ?? "", sponsoredHistory: affiliate.sponsoredHistory ?? "", promotionPlan: affiliate.promotionPlan ?? "", similarCampaignPerformance: affiliate.similarCampaignPerformance ?? "", conflicts: affiliate.conflicts ?? "", redFlags: affiliate.redFlags ?? "", reason: "" });
  const [researchPictures, setResearchPictures] = useState<ResearchPictureFiles>(emptyResearchPictures);
  function addPictures(key: ResearchPictureKey, incoming: File[]) {
    setResearchPictures((current) => ({ ...current, [key]: [...current[key], ...incoming.filter((file) => file.type.startsWith("image/"))] }));
  }
  function removePicture(key: ResearchPictureKey, index: number) {
    setResearchPictures((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
  }
  const labels = { handle: "Researched username", channelUrl: "Primary channel URL", subtype: "Channel subtype", niche: "Niche", tier: "Internal quality tier", source: "Recruitment source", audienceSize: "Audience size", engagementRate: "Engagement / subtype rate (%)", demographics: "Demographics research", subtypeMetrics: "Subtype-specific metrics", channelPermission: "Channel ownership / permission", sponsoredHistory: "Sponsored-content history", promotionPlan: "Promotion / traffic plan", similarCampaignPerformance: "Similar-campaign performance", adminBio: "Admin-written bio", conflicts: "Conflicts", redFlags: "Red flags", adminNotes: "Internal notes" };
  const longFields = ["adminBio", "adminNotes", "subtypeMetrics", "channelPermission", "sponsoredHistory", "promotionPlan", "similarCampaignPerformance", "conflicts", "redFlags"];
  const fullFields = [...longFields, "demographics"];
  return <ModalShell title="Edit audience research" onClose={onClose} wide><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("save_research", { ...draft, researchPictures, audienceSize: Number(draft.audienceSize), engagementRate: Number(draft.engagementRate) }); }}><div className="source-notice"><Pencil size={17} /> Admin-researched and Admin-authored values only. Affiliate-confirmed and Stripe-owned truth stays unchanged.</div><div className="form-grid">{Object.entries(labels).map(([key, label]) => <label className={fullFields.includes(key) ? "full-field" : ""} key={key}>{label}{longFields.includes(key) ? <textarea value={(draft as any)[key]} onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))} /> : key === "tier" ? <select value={draft.tier} onChange={(e) => setDraft((current) => ({ ...current, tier: e.target.value }))}><option>Tier A</option><option>Tier B</option><option>Tier C</option></select> : <input type={key === "channelUrl" ? "url" : ["audienceSize", "engagementRate"].includes(key) ? "number" : "text"} value={(draft as any)[key]} onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))} />}</label>)}</div><section className="research-picture-edit"><h3>Add picture evidence</h3><p>Pictures stay associated with the specific research item.</p>{RESEARCH_PICTURE_FIELDS.map(({ key, label }) => <ResearchPictureUpload key={key} id={`edit-${key}`} title={label} files={researchPictures[key]} onAdd={(items) => addPictures(key, items)} onRemove={(index) => removePicture(key, index)} />)}</section><label>Reason for change<textarea value={draft.reason} onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))} required /></label><button className="primary" type="submit">Save audience research</button></form></ModalShell>;
}

function AccountCorrectionModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const choices = [
    { field: "name", label: "Name", value: affiliate.name },
    { field: "email", label: "Email", value: affiliate.email },
    { field: "phone", label: "Phone number · unverified", value: affiliate.phone ?? "" },
    { field: "location", label: "Location", value: affiliate.location },
    { field: "handle", label: "Username", value: affiliate.handle },
  ] as const;
  const [field, setField] = useState<(typeof choices)[number]["field"]>("name");
  const selected = choices.find((item) => item.field === field)!;
  const [newValue, setNewValue] = useState(selected.value);
  const [reason, setReason] = useState("");
  function choose(next: typeof field) { const item = choices.find((choice) => choice.field === next)!; setField(next); setNewValue(item.value); }
  return <ModalShell title="Correct account information" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("correct_account", { field, label: selected.label, newValue, reason }); }}><div className="source-notice"><History size={17} /> This correction appends a new current value. The prior value, Admin actor, reason and time remain in history.</div><label>Account field<select value={field} onChange={(event) => choose(event.target.value as typeof field)}>{choices.map((item) => <option key={item.field} value={item.field}>{item.label}</option>)}</select></label><dl className="modal-facts"><div><dt>Previous value</dt><dd>{selected.value || "Not supplied"}</dd></div><div><dt>Provenance</dt><dd>Affiliate supplied · Admin correction</dd></div></dl><label>Corrected value<input type={field === "email" ? "email" : "text"} value={newValue} onChange={(event) => setNewValue(event.target.value)} required /></label><label>Correction reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label><button className="primary" type="submit">Record corrected account information</button></form></ModalShell>;
}

function ProfileCorrectionModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [field, setField] = useState(`Username · ${affiliate.handle}`);
  const [note, setNote] = useState("");
  return <ModalShell title="Request Affiliate correction" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("request_profile_correction", { field, note }); }}><label>Affiliate-owned field<select value={field} onChange={(e) => setField(e.target.value)}><option>Username · {affiliate.handle}</option><option>Name · {affiliate.name}</option><option>Email · {affiliate.email}</option><option>Phone number · {affiliate.phone ?? "Not supplied"}</option><option>Location · {affiliate.location}</option></select></label><label>What should be checked<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="State the suspected issue and the evidence needed." required /></label><div className="source-notice"><Mail size={17} /> The current value remains until the Affiliate supplies a correction.</div><button className="primary" type="submit">Send Affiliate correction request</button></form></ModalShell>;
}

function UploadEvidenceModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  return <ModalShell title="Upload research evidence" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("upload_evidence", { files }); }}><div className="upload-zone"><Upload size={28} /><label htmlFor="evidence-upload">Choose images or documents</label><input id="evidence-upload" type="file" multiple accept="image/*,.pdf,.csv,.xlsx" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} required /><span>{files.length ? files.map((file) => file.name).join(" · ") : `Associate evidence with ${affiliate.handle}`}</span></div><button className="primary" type="submit" disabled={!files.length}>Upload {files.length || ""} evidence file{files.length === 1 ? "" : "s"}</button></form></ModalShell>;
}

function VerifyEvidenceModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [confirmed, setConfirmed] = useState({ channel: false, metrics: false, demographics: false });
  const ready = Object.values(confirmed).every(Boolean) && affiliate.evidence.length > 0;
  return <ModalShell title="Verify audience evidence" onClose={onClose}><div className="modal-body"><div className="evidence-decision-fact"><strong>{affiliate.handle}</strong><span>{affiliate.audienceSize.toLocaleString()} audience · {affiliate.engagementRate || "—"}% engagement</span><span>{affiliate.evidence.length} evidence records</span></div><div className="modal-checks">{([['channel', 'Evidence belongs to the approved channel'], ['metrics', 'Audience and engagement values match evidence'], ['demographics', 'Subtype-appropriate demographics are supported']] as const).map(([id, label]) => <button key={id} className={confirmed[id] ? "checked" : ""} onClick={() => setConfirmed((current) => ({ ...current, [id]: !current[id] }))}><span>{confirmed[id] && <Check size={15} />}</span>{label}</button>)}</div><button className="primary" disabled={!ready} onClick={() => onAction("verify_evidence")}>Verify audience evidence</button><button className="secondary" onClick={() => onAction("request_evidence", { metric: "Audience verification", note: "Submitted evidence does not support every required metric." })}>Request more evidence instead</button></div></ModalShell>;
}

function RequestEvidenceModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [metric, setMetric] = useState("Engagement rate");
  const [note, setNote] = useState("");
  return <ModalShell title="Request more evidence" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("request_evidence", { metric, note }); }}><label>Evidence needed<select value={metric} onChange={(e) => setMetric(e.target.value)}><option>Audience size</option><option>Engagement rate</option><option>Audience demographics</option><option>Channel ownership</option><option>Newsletter permission basis</option></select></label><label>Affiliate-facing request<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Tell ${affiliate.name.split(" ")[0]} which screenshot, analytics export, or document is needed.`} required /></label><button className="primary" type="submit">Send evidence request</button></form></ModalShell>;
}

function InvitationModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  const canSend = ["draft", "revoked", "expired", "delivery_failed"].includes(affiliate.invitation);
  const canRevoke = ["sent", "delivered", "opened", "signup_started"].includes(affiliate.invitation);
  return <ModalShell title="Campaign invitation" onClose={onClose} wide><div className="modal-body"><div className="summary-block"><strong>{invitationCopy(affiliate.invitation)}</strong><span>{affiliate.email}</span><span>{affiliate.campaigns[0]?.name} · private campaign-specific claim</span></div><dl className="modal-facts invitation-timeline"><div><dt>Created</dt><dd>{affiliate.events.find((item) => item.title.toLowerCase().includes("prospect"))?.time ?? "Recorded"}</dd></div><div><dt>Sent</dt><dd>{affiliate.invitationSentAt ?? "Not sent"}</dd></div><div><dt>Delivered</dt><dd>{affiliate.invitationDeliveredAt ?? (affiliate.invitation === "delivery_failed" ? "Failed" : "Not recorded")}</dd></div><div><dt>Opened</dt><dd>{affiliate.invitationOpenedAt ?? "Not supported / not recorded"}</dd></div><div><dt>Signup started</dt><dd>{affiliate.signupStartedAt ?? "Not started"}</dd></div><div><dt>Claimed</dt><dd>{affiliate.claimedAt ?? "Not claimed"}</dd></div><div><dt>Expiry</dt><dd>{affiliate.invitationExpiresAt ?? "Artifact duration is an implementation decision"}</dd></div><div><dt>Delivery failure</dt><dd>{affiliate.invitationFailure ?? "None"}</dd></div><div><dt>Token</dt><dd>{affiliate.invitation === "claimed" ? "Revoked automatically after claim" : affiliate.invitation === "revoked" ? "Revoked by Admin" : "Scoped to one Affiliate and campaign"}</dd></div></dl>{affiliate.invitationFailure && <div className="consequence-block"><AlertTriangle size={20} /><p>{affiliate.invitationFailure}</p></div>}<div className="context-actions">{canSend ? <button className="primary" onClick={() => onAction("send_invitation")}>Send campaign invitation</button> : affiliate.invitation !== "claimed" && <button className="primary" onClick={() => onAction("resend_invitation")}>Resend campaign invitation</button>}</div>{canRevoke && <><label>Revocation reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label><button className="secondary" disabled={!reason.trim()} onClick={() => onAction("revoke_invitation", { reason })}>Revoke campaign invitation</button></>}<div className="source-notice"><History size={17} /> Every send, delivery result, open when supported, signup start, claim, resend, revoke, expiry and safe-error event remains in history. Retries are deduplicated.</div></div></ModalShell>;
}

function AssignCampaignModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [draft, setDraft] = useState({ campaignName: "", founder: "", designation: "Initial launch roster" as CampaignRelationship["designation"], reason: "" });
  function chooseCampaign(campaignName: string) {
    const selectedCampaignChoice = CAMPAIGN_CHOICES.find((campaignChoice) => campaignChoice.name === campaignName);
    setDraft((current) => ({ ...current, campaignName, founder: selectedCampaignChoice?.founder ?? "" }));
  }
  return <ModalShell title="Assign to campaign" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("assign_campaign", draft); }}><div className="summary-block"><strong>{affiliate.name}</strong><span>{affiliate.campaigns.length} existing campaign relationships</span></div><label>Campaign name<select value={draft.campaignName} onChange={(e) => chooseCampaign(e.target.value)} required><option value="">Select campaign</option>{CAMPAIGN_CHOICES.map((campaignChoice) => <option key={campaignChoice.name} value={campaignChoice.name}>{campaignChoice.name}</option>)}</select></label><label>Founder<select value={draft.founder} onChange={(e) => setDraft((current) => ({ ...current, founder: e.target.value }))} required><option value="">Select Founder</option>{FOUNDER_CHOICES.map((founder) => <option key={founder}>{founder}</option>)}</select></label><label>Roster designation<select value={draft.designation} onChange={(e) => setDraft((current) => ({ ...current, designation: e.target.value as CampaignRelationship["designation"] }))}><option>Initial launch roster</option><option>Mid-campaign addition</option></select></label><label>Assignment reason<textarea value={draft.reason} onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))} required /></label><button className="primary" type="submit">Create campaign relationship</button></form></ModalShell>;
}

function RelationshipFieldsModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [designation, setDesignation] = useState<CampaignRelationship["designation"]>(campaign.designation);
  const [recruitmentSource, setRecruitmentSource] = useState("Admin campaign sourcing plan");
  const [reason, setReason] = useState("");
  const [version, setVersion] = useState("Campaign terms version");
  const [changedField, setChangedField] = useState("Required work");
  const [previousValue, setPreviousValue] = useState("");
  const [newValue, setNewValue] = useState("");
  return <ModalShell title="Edit campaign relationship data" onClose={onClose}><div className="modal-body"><div className="source-notice"><Pencil size={17} /> Admin-owned relationship data only. Compensation and bilateral acceptance stay immutable.</div><label>Roster designation<select value={designation} onChange={(event) => setDesignation(event.target.value as CampaignRelationship["designation"])}><option>Initial launch roster</option><option>Mid-campaign addition</option></select></label><label>Recruitment source<input value={recruitmentSource} onChange={(event) => setRecruitmentSource(event.target.value)} /></label><label>Change reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label><button className="primary" disabled={!reason.trim()} onClick={() => onAction("save_relationship", { designation, recruitmentSource, reason })}>Save campaign relationship data</button><div className="material-change-block"><h3>Material campaign change</h3><label>Affected field<select value={changedField} onChange={(event) => setChangedField(event.target.value)}><option>Compensation</option><option>Required work</option><option>Dates</option><option>Rewards or prices</option><option>Approved claims</option><option>Delivery</option><option>Refund terms</option><option>Promotion channel</option><option>Upfront fee conditions</option></select></label><label>Previous value<textarea value={previousValue} onChange={(event) => setPreviousValue(event.target.value)} /></label><label>New value<textarea value={newValue} onChange={(event) => setNewValue(event.target.value)} /></label><label>Version requiring Affiliate acceptance<input value={version} onChange={(event) => setVersion(event.target.value)} /></label><button className="secondary" disabled={!reason.trim() || !version.trim() || !previousValue.trim() || !newValue.trim()} onClick={() => onAction("require_relationship_reacceptance", { version, reason, changedField, previousValue, newValue })}>Require Affiliate reacceptance</button></div></div></ModalShell>;
}

function CampaignKitModal({ campaign, onClose }: { campaign: CampaignRelationship; onClose: () => void }) {
  return <SimpleModal title={`Visual Campaign kit · version ${campaign.kitVersion}`} onClose={onClose} wide><div className="kit-modal"><section><p className="eyebrow">Proovd-provided visuals</p><h3>{campaign.name}</h3><p>{campaign.kitAssets.length} approved visual assets · private campaign access</p></section><div className="kit-visual-grid">{campaign.kitAssets.map((asset, index) => <article key={asset}><div className={`kit-visual-preview kit-visual-${(index % 3) + 1}`} aria-label={`${asset} preview`}><span>proovd<span>.</span></span></div><strong>{asset}</strong><small>Proovd provided · approved</small></article>)}</div><dl className="modal-facts"><div><dt>Provider</dt><dd>Proovd</dd></div><div><dt>Scope</dt><dd>{campaign.name}</dd></div><div><dt>Access</dt><dd>Private · authenticated · campaign-scoped</dd></div><div><dt>Version</dt><dd>{campaign.kitVersion}</dd></div></dl><button className="secondary full-button" onClick={onClose}>Close visual Campaign kit</button></div></SimpleModal>;
}

function ReadinessModal({ affiliate, campaign, onClose }: { affiliate: Affiliate; campaign: CampaignRelationship; onClose: () => void }) {
  const providerReady = affiliate.providerState === "ready";
  const accepted = campaignAgreementAccepted(campaign);
  const upfrontFeeApplies = campaign.type === "Product Campaign" && campaign.fixedPayment !== "Not requested";
  const upfrontFeeReady = !upfrontFeeApplies || (!campaign.fixedPayment.includes("pending") && !campaign.fixedPayment.includes("failed") && !campaign.fixedPayment.includes("not accepted"));
  const items = [
    ["Campaign, rewards and incentives approved", true, "Admin"], ["Exact compensation version mutually accepted", accepted, accepted ? "System" : "Affiliate / Founder"],
    ["Proovd visual Campaign kit available", campaign.kitVersion > 0 && campaign.kitAssets.length > 0, "Proovd"], ["Approved claims and prohibited claims recorded", true, "Admin"],
    ["Affiliate link and attribution route created", campaign.trackingLink.startsWith("http"), "System"], ["FTC disclosure text available", true, "Admin"],
    ["Required work and availability terms accepted", campaign.deliverables.length > 0, "Affiliate / Founder"], ["Per-campaign IP / confidentiality accepted", accepted, accepted ? "Affiliate" : "Affiliate"],
    ["Campaign Terms / AUP acceptance current", affiliate.policyState !== "reacceptance_required", "Affiliate"], ["Upfront fee fully funded when applicable", upfrontFeeReady, upfrontFeeReady ? "Founder" : "Founder"],
    ["Stripe transfer capability ready", providerReady, providerReady ? "Stripe" : "Affiliate"], ["Campaign and Creator launch plan scheduled", ["active", "accepted", "creator_prep"].includes(campaign.state), "Admin"],
  ] as const;
  const complete = items.filter((item) => item[1]).length;
  return <SimpleModal title="Complete Creator readiness checklist" onClose={onClose} wide><div className="readiness-summary"><strong>{complete} of {items.length}</strong><span>{complete === items.length ? "Ready" : `${items.length - complete} blocker${items.length - complete === 1 ? "" : "s"}`}</span></div><div className="readiness-object-list">{items.map(([label, ready, owner]) => <div key={label} className={ready ? "ready" : "blocked"}><span>{ready ? <Check size={16} /> : <Clock3 size={16} />}</span><strong>{label}</strong><small>{ready ? "Complete" : `Owner · ${owner}`}</small></div>)}</div><div className="source-notice"><History size={17} /> Each checklist item keeps its evidence, version, reviewer, completion time and later invalidation history.</div><button className="secondary full-button" onClick={onClose}>Close readiness checklist</button></SimpleModal>;
}

function AgreementHistoryModal({ campaign, onClose }: { campaign: CampaignRelationship; onClose: () => void }) {
  const accepted = campaignAgreementAccepted(campaign);
  const termsLocked = campaignTermsAreLocked(campaign);
  const upfrontFeeSummary = campaign.type === "Idea Campaign" ? "No upfront fee available" : campaign.fixedPayment === "Not requested" ? "No upfront fee requested" : `Upfront fee ${campaign.fixedPayment}`;
  const versions = accepted ? [[termsLocked ? "Version 3 · locked at launch" : "Version 3 · accepted", `${campaign.compensation} · ${upfrontFeeSummary}`, termsLocked ? "Affiliate and Founder accepted · locked when campaign went live" : "Affiliate and Founder accepted · locks when campaign goes live"], ["Version 2", "Previous compensation version", "Founder revised · Aug 8, 1:45 PM"], ["Version 1", "Initial compensation proposal", "Affiliate proposed · Aug 8, 12:58 PM"]] : [["Version 2 · pending", `${campaign.compensation} · ${upfrontFeeSummary}`, "Founder response due tomorrow"], ["Version 1", "Initial compensation proposal", "Affiliate proposed yesterday"]];
  return <SimpleModal title="Agreement version history" onClose={onClose} wide><ol className="version-list">{versions.map(([title, terms, meta]) => <li key={title}><strong>{title}</strong><span>{terms}</span><small>{meta}</small></li>)}</ol><div className="source-notice"><LockKeyhole size={17} /> Previous versions cannot be edited or accepted after a newer proposal exists.</div><button className="secondary full-button" onClick={onClose}>Close agreement history</button></SimpleModal>;
}

function ProposalModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  return <ModalShell title="Review commercial proposal" onClose={onClose} wide><div className="modal-body"><div className="proposal-object"><span>Revision 2 · waiting on Founder</span><h3>{campaign.compensation}</h3><p>{campaign.bonus} · {campaign.fixedPayment}</p><small>Admin cannot accept for either party.</small></div><label>Mediation note<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clarify terms without substituting for bilateral acceptance." /></label><button className="primary" disabled={!note.trim()} onClick={() => onAction("proposal_mediation", { note })}>Record proposal mediation note</button><label>Policy violation reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required only when the proposal violates the compensation matrix or ceiling." /></label><button className="secondary" disabled={!reason.trim()} onClick={() => onAction("proposal_reject", { reason })}>Reject policy-invalid proposal</button></div></ModalShell>;
}

function LinkControlsModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Affiliate link history & controls" onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{linkCopy(campaign.linkState)}</strong><span className="truncate">{campaign.trackingLink}</span><span>Activated {campaign.activated}</span></div>{campaign.trackingLink.startsWith("http") && <div className="context-actions"><button className="secondary" onClick={() => navigator.clipboard?.writeText(campaign.trackingLink)}>Copy Affiliate link</button><a className="secondary" href={campaign.trackingLink} target="_blank" rel="noreferrer" data-press>Open Affiliate link <ExternalLink size={15} /></a><button className="tertiary" onClick={() => onAction("safe_test_link")}>Safe test Affiliate link</button></div>}<label>Recorded reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for any link state change or replacement." /></label><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication required for pause, reactivation or replacement.</div>{campaign.linkState === "active" ? <button className="primary" disabled={!reason.trim()} onClick={() => onAction("pause_link", { reason })}>Pause Affiliate link</button> : <button className="primary" disabled={!reason.trim()} onClick={() => onAction("reactivate_link", { reason })}>Reactivate Affiliate link</button>}<button className="secondary" disabled={!reason.trim()} onClick={() => onAction("replace_link", { reason })}>Update Affiliate link</button><div className="source-notice"><History size={17} /> Old links and activation times remain in history. Replacement never creates retroactive attribution.</div></div></ModalShell>;
}

function PostHistoryModal({ campaign, onClose }: { campaign: CampaignRelationship; onClose: () => void }) {
  return <SimpleModal title="Submitted post history" onClose={onClose} wide><ol className="version-list post-version-list">{campaign.postVersions.slice().reverse().map((item) => <li key={item.version}><strong>Version {item.version} · {item.status}</strong><a href={item.url} target="_blank" rel="noreferrer" data-press>{item.url} <ExternalLink size={14} /></a><small>{item.submittedAt}</small></li>)}</ol><button className="secondary full-button" onClick={onClose}>Close post history</button></SimpleModal>;
}

function PostResubmissionModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [url, setUrl] = useState("");
  return <ModalShell title="Record corrected post URL" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("post_resubmission", { url }); }}><div className="source-notice"><History size={17} /> Version {campaign.postVersions.at(-1)?.version ?? 1} remains preserved.</div><label>New public post URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required /></label><button className="primary" type="submit">Save corrected post and reopen review</button></form></ModalShell>;
}

function PostDecisionModal({ mode, campaign, onClose, onAction }: { mode: "post_reject" | "post_escalate"; campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  const serious = mode === "post_escalate";
  return <ModalShell title={serious ? "Escalate serious post issue" : "Reject submitted post"} onClose={onClose}><div className="modal-body"><div className="consequence-block"><ShieldAlert size={22} /><p>{serious ? "The Affiliate link pauses and an enforcement case opens for human review." : "The post is rejected, the Affiliate link pauses, and the decision remains appealable where policy allows."}</p></div><a className="external-text-link" href={campaign.postVersions.at(-1)?.url} target="_blank" rel="noreferrer" data-press>Open submitted post <ExternalLink size={15} /></a><label>Decision reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><button className="primary danger-primary" disabled={!reason.trim()} onClick={() => onAction(serious ? "post_escalate" : "post_reject", { reason })}>{serious ? "Escalate serious issue" : "Reject submitted post"}</button></div></ModalShell>;
}

function DeliverableModal({ deliverable, onClose, onAction }: { deliverable: Deliverable; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [note, setNote] = useState("");
  return <ModalShell title="Review deliverable evidence" onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{deliverable.title}</strong><span>{deliverableCopy(deliverable.state)}</span>{deliverable.proofUrl && <a href={deliverable.proofUrl} target="_blank" rel="noreferrer" data-press>Open submitted proof <ExternalLink size={14} /></a>}</div><div className="decision-checklist"><span><Check size={15} /> Agreed work is present</span><span><Check size={15} /> Proof is publicly accessible</span><span><Check size={15} /> Campaign guidance is followed</span></div><label>Decision note<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Required for waiver or evidence request." /></label><button className="primary" onClick={() => onAction("deliverable_verify", { note })}>Verify deliverable</button><button className="secondary" disabled={!note.trim()} onClick={() => onAction("deliverable_more_evidence", { note })}>Request more deliverable evidence</button><button className="tertiary" disabled={!note.trim()} onClick={() => onAction("deliverable_waive", { note })}>Record Founder/Admin waiver</button></div></ModalShell>;
}

function AvailabilityModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [evidence, setEvidence] = useState("");
  return <ModalShell title="Verify content availability" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("availability_verify", { through: campaign.availabilityTerm, evidence }); }}><div className="summary-block"><strong>{campaign.name}</strong><span>{campaign.availabilityTerm}</span><span>{campaign.deliverables.filter((item) => item.proofUrl).length} public proof URLs</span></div><label>Evidence or check note<textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Public URLs checked against the accepted availability term." required /></label><button className="primary" type="submit">Verify content availability</button></form></ModalShell>;
}

function TransferModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [checked, setChecked] = useState(false);
  return <ModalShell title="Create Affiliate Transfer" onClose={onClose}><div className="modal-body"><div className="money-preview"><span>Transfer amount</span><strong>${campaign.earningsAmount.toFixed(2)}</strong><small>One campaign-specific Transfer</small></div><dl className="modal-facts"><div><dt>Commission</dt><dd>Finalized</dd></div><div><dt>Bonus</dt><dd>Resolved</dd></div><div><dt>Upfront fee</dt><dd>{campaign.fixedPayment}</dd></div><div><dt>Stripe recipient</dt><dd>Ready</dd></div></dl><button className={`confirm-check ${checked ? "checked" : ""}`} onClick={() => setChecked(!checked)}><span>{checked && <Check size={15} />}</span> I reviewed the amount, cause adjustments and provider recipient</button><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication required · idempotent creation</div><button className="primary" disabled={!checked} onClick={() => onAction("transfer")}>Create ${campaign.earningsAmount.toFixed(2)} Affiliate Transfer</button></div></ModalShell>;
}

function EarningsAdjustmentModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [amount, setAmount] = useState(String(campaign.earningsAmount));
  const [reason, setReason] = useState("");
  return <ModalShell title="Adjust Affiliate earnings" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("adjust_earnings", { amount, reason }); }}><div className="consequence-block"><CircleDollarSign size={22} /><p>This appends a ledger adjustment. A negative amount requires causal invalidity evidence and creates or updates the recovery record; it does not edit Stripe identity or bank facts.</p></div><label>Adjusted amount (USD)<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label><label>Cause, evidence and Founder / Affiliate treatment<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication and immutable before/after audit required.</div><button className="primary" type="submit">Record earnings adjustment</button></form></ModalShell>;
}

function FixedDecisionModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Decide upfront fee outcome" onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{campaign.fixedPayment}</strong><span>{campaign.deliverables.filter((item) => item.state === "verified" || item.state === "waived").length} of {campaign.deliverables.length} deliverables resolved</span><span>Post · {postCopy(campaign.postState)}</span></div><label>Decision evidence and reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><button className="primary" disabled={!reason.trim()} onClick={() => onAction("fixed_eligible", { reason })}>Mark upfront fee eligible</button><button className="secondary" disabled={!reason.trim()} onClick={() => onAction("fixed_return", { reason })}>Return upfront fee allocation to Founder</button></div></ModalShell>;
}

function CompletionModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const checks = ["Creator readiness cleared before work", "At least one valid post passed", "Every deliverable verified or waived", "No unresolved fraud or compliance case", "Upfront fee, earnings and Transfer resolved or recorded"];
  const [confirmed, setConfirmed] = useState(checks.map(() => false));
  const [reason, setReason] = useState("");
  const ready = confirmed.every(Boolean);
  return <ModalShell title="Review successful completion" onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{campaign.name}</strong><span>Sales performance is not a completion requirement.</span></div><div className="modal-checks">{checks.map((label, index) => <button key={label} className={confirmed[index] ? "checked" : ""} onClick={() => setConfirmed((current) => current.map((value, position) => position === index ? !value : value))}><span>{confirmed[index] && <Check size={15} />}</span>{label}</button>)}</div><label>Completion evidence or disqualifying reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><button className="primary" disabled={!ready || !reason.trim()} onClick={() => onAction("completion_approve", { reason })}>Approve successful completion</button><button className="secondary" disabled={!reason.trim()} onClick={() => onAction("completion_decline", { reason })}>Decline successful completion</button></div></ModalShell>;
}

function WorkAgainModal({ campaign, onClose, onAction }: { campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  return <SimpleModal title="Work-again request" onClose={onClose}><div className="summary-block"><strong>{campaign.name}</strong><span>Founder request · {campaign.workAgain}</span><span>Affiliate accepts or declines without penalty.</span></div><dl className="modal-facts"><div><dt>Eligibility</dt><dd>{campaign.completion === "successful" ? "Eligible" : "Blocked"}</dd></div><div><dt>Creates campaign</dt><dd>No</dd></div><div><dt>Cooldown bypass</dt><dd>No</dd></div></dl><button className="primary full-button" onClick={() => onAction("work_again_reissue")}>Reissue work-again request</button><label>Completion correction reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="tertiary full-button" disabled={!reason.trim()} onClick={() => onAction("completion_correct", { reason })}>Correct completion record and recalculate eligibility</button><button className="secondary full-button" onClick={onClose}>Close work-again record</button></SimpleModal>;
}

function RecordCaseModal({ onClose, onAction }: { onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [kind, setKind] = useState<CaseKind>("conflict");
  const [detail, setDetail] = useState("");
  const [due, setDue] = useState("Today · 4:00 PM EDT");
  return <ModalShell title="Record a compliance or support case" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("record_case", { kind, detail, due }); }}><label>Case type<select value={kind} onChange={(e) => setKind(e.target.value as CaseKind)}><option value="conflict">Affiliate conflict disclosure</option><option value="self_preorder">Affiliate self-preorder</option><option value="termination">Active termination request</option><option value="creator_failure">Required Creator failure / ghosting</option><option value="appeal">Affiliate policy appeal</option><option value="support">Affiliate support / account recovery</option><option value="refund">Refund or cause-allocation review</option><option value="payout_recovery">Payout or Transfer recovery</option><option value="negative_balance">Negative balance recovery</option><option value="deletion">Account deletion and retention review</option></select></label><label>Evidence, verified facts and preserved context<textarea value={detail} onChange={(e) => setDetail(e.target.value)} required /></label><label>Owner and decision due<select value={due} onChange={(e) => setDue(e.target.value)}><option>Today · 4:00 PM EDT</option><option>One business day · 5:00 PM EDT</option><option>48-hour Founder follow-up · 5:00 PM EDT</option><option>Three US business days · 5:00 PM EDT</option><option>Five business days · 5:00 PM EDT</option></select></label><button className="primary" type="submit">Record case and open review</button></form></ModalShell>;
}

function ReviewCaseModal({ supportCase, onClose, onAction }: { supportCase: SupportCase; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [outcome, setOutcome] = useState(caseOutcomes(supportCase.kind)[0]);
  const [reason, setReason] = useState("");
  return <ModalShell title={`Review ${caseActionNoun(supportCase.kind)}`} onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("resolve_case", { outcome, reason }); }}><div className="summary-block"><strong>{supportCase.title}</strong><span>{supportCase.detail}</span><span>Owner {supportCase.owner} · due {supportCase.due}</span></div><label>Decision<select value={outcome} onChange={(e) => setOutcome(e.target.value)}>{caseOutcomes(supportCase.kind).map((item) => <option key={item}>{item}</option>)}</select></label><label>Decision reason and evidence<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><button className="primary" type="submit">Record case decision</button></form></ModalShell>;
}

function EnforcementModal({ mode, affiliate, campaign, onClose, onAction }: { mode: "warning" | "suspend"; affiliate: Affiliate; campaign: CampaignRelationship | null; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [category, setCategory] = useState("");
  const [internalReason, setInternalReason] = useState("");
  const [customerCopy, setCustomerCopy] = useState("");
  const [appealDue, setAppealDue] = useState("Five business days");
  return <ModalShell title={mode === "warning" ? "Issue Affiliate warning" : "Suspend Affiliate account"} onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction(mode, { category, internalReason, customerCopy, appealDue }); }}><div className="consequence-block"><ShieldAlert size={22} /><p>{mode === "warning" ? `${affiliate.name} keeps access. The warning records correction and appeal context.` : `${affiliate.name} loses account access and ${campaign?.name ?? "active"} Affiliate links pause.`}</p></div><label>Reason category<select value={category} onChange={(e) => setCategory(e.target.value)} required><option value="" disabled>Choose a reason</option><option>Deceptive or unsupported claim</option><option>Metric manipulation or fraud</option><option>Host-rule violation</option><option>Provider or regulatory risk</option><option>Repeated invalid termination</option></select></label><label>Evidence and internal reason<textarea value={internalReason} onChange={(e) => setInternalReason(e.target.value)} required /></label><label>Affiliate-facing explanation<textarea value={customerCopy} onChange={(e) => setCustomerCopy(e.target.value)} placeholder="State evidence, rule, immediate effect, correction and human appeal route." required /></label><label>Appeal deadline<select value={appealDue} onChange={(e) => setAppealDue(e.target.value)}><option>Five business days</option><option>Appeal not available under policy</option></select></label>{mode === "suspend" && <div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication required.</div>}<button className={`primary ${mode === "suspend" ? "danger-primary" : ""}`} type="submit">{mode === "warning" ? "Issue Affiliate warning" : "Suspend Affiliate account"}</button></form></ModalShell>;
}

function RestoreModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Restore Affiliate account" onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{affiliate.name}</strong><span>Account suspended · links remain paused until restored</span></div><label>Resolution and evidence<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication required.</div><button className="primary" disabled={!reason.trim()} onClick={() => onAction("restore", { reason })}>Restore Affiliate account</button></div></ModalShell>;
}

function RemoveModal({ affiliate, campaign, onClose, onAction }: { affiliate: Affiliate; campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  const [moneyTreatment, setMoneyTreatment] = useState("Preserve valid finalized commission; review unfinalized amounts by cause");
  return <ModalShell title="Remove Affiliate from campaign" onClose={onClose}><div className="modal-body"><div className="consequence-block"><Ban size={22} /><p>{affiliate.name} leaves {campaign.name}. The Affiliate link stops. Valid finalized commission is not silently clawed back.</p></div><label>Removal reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><label>Money treatment<select value={moneyTreatment} onChange={(e) => setMoneyTreatment(e.target.value)}><option>Preserve valid finalized commission; review unfinalized amounts by cause</option><option>Affiliate-caused invalidity · cancel unpaid invalid earnings</option><option>Founder-caused termination · preserve valid Affiliate earnings</option></select></label><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication required.</div><button className="primary danger-primary" disabled={!reason.trim()} onClick={() => onAction("remove", { reason, moneyTreatment })}>Remove Affiliate from {campaign.name}</button></div></ModalShell>;
}

function CampaignRiskModal({ mode, campaign, onClose, onAction }: { mode: "campaign_suspend" | "campaign_kill"; campaign: CampaignRelationship; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [phase, setPhase] = useState("Pre-capture · block charges and promotion");
  const [reason, setReason] = useState("");
  const [moneyTreatment, setMoneyTreatment] = useState("Preserve valid finalized Affiliate earnings; review unfinalized amounts by cause");
  const killed = mode === "campaign_kill";
  return <ModalShell title={killed ? "Kill campaign" : "Suspend campaign"} onClose={onClose}><div className="modal-body"><div className="consequence-block"><ShieldAlert size={22} /><p>{killed ? "Campaign activity stops. Pre-capture charges are blocked; post-capture refund, reversal and recovery follow the recorded cause. The public record, evidence and support path remain." : "Campaign activity and Affiliate links pause while the public record, evidence and support path remain available."}</p></div><label>Campaign phase<select value={phase} onChange={(event) => setPhase(event.target.value)}><option>Pre-capture · block charges and promotion</option><option>Post-capture · invoke refund / reversal / recovery review</option></select></label><label>Decision reason and evidence<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label><label>Affiliate money treatment<select value={moneyTreatment} onChange={(event) => setMoneyTreatment(event.target.value)}><option>Preserve valid finalized Affiliate earnings; review unfinalized amounts by cause</option><option>Affiliate-caused invalidity · cancel unpaid invalid earnings and record recovery</option><option>Founder-caused failure · preserve valid finalized Affiliate earnings</option><option>Proovd error · correct without debiting unrelated Affiliate</option></select></label><div className="reauth-note"><LockKeyhole size={17} /> Recent reauthentication, preview, idempotency and immutable audit required.</div><button className="primary danger-primary" disabled={!reason.trim()} onClick={() => onAction(mode, { phase, reason, moneyTreatment })}>{killed ? "Kill campaign and open recovery" : "Suspend campaign"}</button></div></ModalShell>;
}

function AccessDecisionModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [tier, setTier] = useState(affiliate.tier);
  const [proposalAccess, setProposalAccess] = useState(affiliate.proposalAccess);
  const [reason, setReason] = useState("");
  return <ModalShell title="Change internal tier or proposal access" onClose={onClose}><form className="modal-body" onSubmit={(event) => { event.preventDefault(); onAction("access_decision", { tier, proposalAccess, reason }); }}><label>Internal quality tier<select value={tier} onChange={(e) => setTier(e.target.value)}><option>Tier A</option><option>Tier B</option><option>Tier C</option></select></label><label>Proposal access<select value={proposalAccess} onChange={(e) => setProposalAccess(e.target.value as Affiliate["proposalAccess"])}><option value="standard">Standard proposal access</option><option value="restricted">Proposal bidding restricted</option></select></label><label>Decision reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} required /></label><button className="primary" type="submit">Record tier and proposal access</button></form></ModalShell>;
}

function PolicyReacceptanceModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [version, setVersion] = useState("Affiliate AUP v2026.08 · Terms v2026.08");
  const [reason, setReason] = useState("");
  return <ModalShell title={affiliate.policyState === "reacceptance_required" ? "Reissue policy acceptance request" : "Require current policy reacceptance"} onClose={onClose}><div className="modal-body"><div className="consequence-block"><LockKeyhole size={22} /><p>Continued use and active Affiliate links pause until the Affiliate accepts the material policy version.</p></div><label>Material policy version<input value={version} onChange={(event) => setVersion(event.target.value)} required /></label><label>Material change and reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label><button className="primary" disabled={!version.trim() || !reason.trim()} onClick={() => onAction("policy_reacceptance", { version, reason })}>{affiliate.policyState === "reacceptance_required" ? "Reissue policy acceptance request" : "Require current policy reacceptance"}</button></div></ModalShell>;
}

function DeletionRequestModal({ affiliate, onClose, onAction }: { affiliate: Affiliate; onClose: () => void; onAction: (action: string, payload?: Record<string, any>) => void }) {
  const [reason, setReason] = useState("");
  return <ModalShell title="Record Affiliate deletion request" onClose={onClose}><div className="modal-body"><div className="consequence-block"><FileText size={22} /><p>The user-facing account may be deleted only after active obligations are resolved. Tax, provider-status, campaign and audit records remain subject to account-life-plus-seven-years retention.</p></div><dl className="modal-facts"><div><dt>Affiliate</dt><dd>{affiliate.name}</dd></div><div><dt>Active relationships</dt><dd>{affiliate.campaigns.filter((item) => !["closed_resolved", "removed"].includes(item.state)).length}</dd></div><div><dt>Current request</dt><dd>{affiliate.deletionState === "retention_review" ? "Retention review open" : "None"}</dd></div></dl><label>Request context and reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required /></label><button className="primary danger-primary" disabled={!reason.trim()} onClick={() => onAction("deletion_request", { reason })}>Record deletion request and open retention review</button></div></ModalShell>;
}

function SearchModal({ query, results, onQuery, onChoose, onClose }: { query: string; results: SearchResult[]; onQuery: (value: string) => void; onChoose: (item: SearchResult) => void; onClose: () => void }) {
  return <div className="overlay search-overlay" onMouseDown={onClose}><section className="search-modal" role="dialog" aria-modal="true" aria-label="Search Admin objects" onMouseDown={(event) => event.stopPropagation()}><div className="search-input"><Search size={20} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Find an Affiliate, campaign, post…" /><button onClick={onClose} aria-label="Close search"><X size={19} /></button></div><p>Affiliate objects</p><div className="search-results">{results.map((item) => <button key={item.key} onClick={() => onChoose(item)}><span><strong>{item.title}</strong><small>{item.meta}</small></span><ArrowRight size={17} /></button>)}{!results.length && <div className="no-search-result">No matching Affiliate object</div>}</div></section></div>;
}

function ContextHeader({ eyebrow, title, onBack, backLabel }: { eyebrow: string; title: string; onBack: () => void; backLabel: string }) {
  return <header className="context-header" data-moment><button className="back-control" onClick={onBack}><ArrowLeft size={17} /> {backLabel}</button><div><p>{eyebrow}</p><h1>{title}</h1></div></header>;
}

function ObjectTask({ owner, title, meta, action, onAction }: { owner: Attention["owner"]; title: string; meta: string; action: string; onAction: () => void }) {
  return <section className="object-task" data-moment><div><span className={`owner-dot owner-${owner.toLowerCase()}`}>Owner · {owner}</span><h2>{title}</h2><p>{meta}</p></div><button className="primary" onClick={onAction}>{action} <ArrowRight size={17} /></button></section>;
}

function WaitingState({ owner, title, meta, action, onAction }: { owner: Attention["owner"]; title: string; meta: string; action?: string; onAction?: () => void }) {
  return <section className="waiting-state" data-moment><span className={`owner-dot owner-${owner.toLowerCase()}`}>Owner · {owner}</span><div><h2>{title}</h2><p>{meta}</p></div>{action && onAction && <button className="secondary" onClick={onAction}>{action} <ArrowRight size={16} /></button>}</section>;
}

function ResearchPictureUpload({ id, title = "Picture evidence", files, onAdd, onRemove }: {
  id: string;
  title?: string;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);
  return <div className="field-picture-upload">
    <div className="field-picture-copy"><strong>{title}</strong><span>PNG, JPG, WEBP or HEIC · multiple pictures allowed</span></div>
    <input id={id} type="file" multiple accept="image/*" onChange={(event) => { onAdd(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <label className="field-picture-button" htmlFor={id}><Upload size={17} /> Add pictures</label>
    {previews.length > 0 && <div className="field-picture-grid">{previews.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}-${index}`}><img src={url} alt={`${title}: ${file.name}`} /><figcaption>{file.name}</figcaption><button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`}><X size={15} /> Remove</button></figure>)}</div>}
  </div>;
}

function EvidencePreview({ asset }: { asset: EvidenceAsset }) {
  if (asset.kind === "generated") return <AnalyticsThumbnail />;
  if (asset.kind === "image" && asset.url) return <img className="evidence-thumb-image" src={asset.url} alt={`${asset.name} preview`} />;
  return <div className="document-thumb"><FileText size={28} /><span>{asset.name.split(".").at(-1)?.toUpperCase() ?? "FILE"}</span></div>;
}

function EvidenceViewer({ asset, affiliate }: { asset: EvidenceAsset; affiliate: Affiliate }) {
  if (asset.kind === "generated") return <AnalyticsThumbnail large />;
  if (asset.kind === "image" && asset.url) return <img className="evidence-full-image" src={asset.url} alt={`${asset.name} uploaded evidence`} />;
  return <div className="document-viewer"><FileText size={48} /><h3>{asset.name}</h3><p>Uploaded evidence associated with {affiliate.handle}</p>{asset.url && <a className="secondary" href={asset.url} target="_blank" rel="noreferrer" data-press>Open uploaded document <ExternalLink size={16} /></a>}</div>;
}

function AnalyticsThumbnail({ large = false }: { large?: boolean }) {
  return <div className={`analytics-shot ${large ? "large" : ""}`} role="img" aria-label="Audience analytics screenshot showing followers, engagement and US audience share"><div className="shot-head"><span>Professional dashboard</span><small>May 1–31</small></div><div className="shot-number">82,412 <span>followers</span></div><div className="shot-bars"><i /><i /><i /><i /><i /><i /><i /></div><div className="shot-foot"><span>4.8% engagement</span><span>71% United States</span></div></div>;
}

function ModalShell({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="overlay" onMouseDown={onClose}><section className={`modal ${wide ? "wide-modal" : ""}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header className="modal-head"><h2>{title}</h2><button onClick={onClose} aria-label={`Close ${title}`}><X size={20} /></button></header>{children}</section></div>;
}

function SimpleModal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <ModalShell title={title} onClose={onClose} wide={wide}><div className="modal-body">{children}</div></ModalShell>;
}

function ConfirmModal({ title, fact, consequence, action, onClose, onConfirm }: { title: string; fact: string; consequence: string; action: string; onClose: () => void; onConfirm: () => void }) {
  return <ModalShell title={title} onClose={onClose}><div className="modal-body"><div className="summary-block"><strong>{fact}</strong><span>{consequence}</span></div><button className="primary" onClick={onConfirm}>{action}</button><button className="secondary" onClick={onClose}>Cancel</button></div></ModalShell>;
}

function verificationCopy(state: VerificationState) {
  return state === "verified" ? "Verified" : state === "needs_evidence" ? "More evidence needed" : "Verification under review";
}

function providerCopy(state: Affiliate["providerState"]) {
  return state === "ready" ? "Payout ready" : state === "needs_information" ? "Stripe needs information" : "Stripe review in progress";
}

function invitationCopy(state: InvitationState) {
  const labels: Record<InvitationState, string> = { draft: "Draft prospect", delivery_failed: "Delivery failed", sent: "Sent", delivered: "Delivered", opened: "Opened", signup_started: "Signup started", claimed: "Claimed", revoked: "Revoked", expired: "Expired" };
  return labels[state];
}

function verificationMetricLabel(subtype: string) {
  if (subtype.includes("Newsletter")) return "Click-through / engagement";
  if (subtype.includes("Podcast")) return "Listen / completion rate";
  if (subtype.includes("Community")) return "Active-user engagement";
  if (subtype.includes("Course")) return "Ratings / learner engagement";
  if (subtype.includes("Student")) return "Promotion-plan evidence";
  if (subtype.includes("Distribution")) return "Traffic-plan quality";
  return "Engagement rate";
}

function linkCopy(state: LinkState) {
  return state === "active" ? "Affiliate link active" : state === "paused" ? "Affiliate link paused" : "Affiliate link inactive";
}

function postCopy(state: PostState) {
  const labels: Record<PostState, string> = { not_submitted: "Not submitted", submitted: "Submitted for Admin review", edits_requested: "Post edits requested", approved: "Post approved", rejected: "Post rejected", escalated: "Serious issue escalated" };
  return labels[state];
}

function deliverableCopy(state: Deliverable["state"]) {
  const labels: Record<Deliverable["state"], string> = { pending: "Waiting on Affiliate", submitted: "Evidence submitted", verified: "Verified", needs_evidence: "More evidence needed", waived: "Founder/Admin waiver" };
  return labels[state];
}

function earningsCopy(state: CampaignRelationship["earningsStatus"]) {
  return state.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function moneyOwner(campaign: CampaignRelationship, affiliate: Affiliate) {
  if (affiliate.providerState === "needs_information") return "Affiliate action required in Stripe";
  if (campaign.earningsStatus === "finalized" || campaign.earningsStatus === "approved for transfer") return "Admin owns the next Transfer decision";
  if (campaign.earningsStatus === "estimated") return "System owns capture and reconciliation after campaign close";
  return "Provider and system state · refresh for the latest result";
}

function attentionAction(attention: Attention) {
  const label = attention.label.toLowerCase();
  if (label.includes("post")) return "Review submitted post";
  if (label.includes("evidence")) return "Review verification evidence";
  if (label.includes("invitation")) return "Review invitation delivery";
  if (label.includes("completion")) return "Review successful completion";
  return "Review Admin decision";
}

function caseActionNoun(kind: CaseKind) {
  const labels: Record<CaseKind, string> = { conflict: "conflict", self_preorder: "self-preorder", termination: "termination request", creator_failure: "Creator failure", appeal: "policy appeal", support: "support case", refund: "cause allocation", payout_recovery: "payout recovery", negative_balance: "negative balance", deletion: "deletion request" };
  return labels[kind];
}

function caseOutcomes(kind: CaseKind) {
  const outcomes: Record<CaseKind, string[]> = {
    conflict: ["Accept disclosed conflict with controls", "Suspend campaign relationship", "Close as no material conflict"],
    self_preorder: ["Exclude from commission and metrics", "Close as genuine disclosed purchase", "Escalate fraud review"],
    termination: ["Approve active termination", "Decline invalid termination", "Request emergency evidence"],
    creator_failure: ["Record failure and start replacement clock", "Continue with remaining Creators", "Close as no failure"],
    appeal: ["Uphold enforcement decision", "Modify enforcement decision", "Restore account or relationship"],
    support: ["Resolve with preserved context", "Wait on Affiliate", "Wait on Founder", "Wait on provider"],
    refund: ["Founder-caused · preserve valid finalized Affiliate earnings", "Affiliate-caused invalidity · cancel unpaid invalid earnings", "Proovd error · correct without debiting unrelated Affiliate", "Mandatory provider / legal outcome"],
    payout_recovery: ["Retry synchronous Transfer creation", "Route Affiliate to Stripe update", "Record provider payout paid", "Record provider payout failed"],
    negative_balance: ["Record contractual recovery", "Record provider reversal", "Record offset or repayment", "Close as unrecoverable with approval"],
    deletion: ["Active obligations block deletion", "Begin lawful deletion / anonymization", "Retain tax, status and audit records", "Close request after retention review"],
  };
  return outcomes[kind];
}
