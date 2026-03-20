# InsureCo AI Platform

A real-world reference implementation of an AI-governed insurance SaaS platform, demonstrating compliance with the **EU AI Act** and **NIST AI Risk Management Framework** using [Sentinel-Ops](https://yadriworks.ai/docs).

## The Problem

Insurance companies deploying AI agents face strict regulatory requirements:

- **EU AI Act** classifies insurance AI (underwriting, claims, fraud detection) as **high-risk** (Annex III, Section 5)
- **NIST AI RMF** requires governance, risk mapping, measurement, and management of AI systems
- Traditional approaches rely on manual audits and self-attestation — they don't scale to autonomous agents making thousands of decisions per day

## The Solution

Every AI agent action passes through a **Safe Operating Envelope (SOE)** enforced by Sentinel-Ops before execution. The SOE defines what each agent can do, what data it can access, and what authority it has — then enforces it deterministically.

```
Agent wants to act ──> SOE Gate evaluates ──> ALLOW / DENY / ESCALATE
                                                  │
                                    Immutable audit trail (Art. 12)
```

## Architecture

```
InsureCo Platform
├── ClaimsBot ──────── [HIGH RISK] Auto-adjudicates claims < €5,000
├── UnderwriteAI ───── [HIGH RISK] Risk scoring without protected characteristics
├── FraudHunter ────── [HIGH RISK] Pattern detection (flag-only, no adjudication)
└── PolicyAdvisor ──── [LIMITED]   Customer Q&A chatbot (read-only)
         │
         ▼
    Sentinel-Ops SOE Gate
    ├── Deterministic pre-filter (<1ms, 95% of calls)
    ├── Sentinel AI (ambiguous cases, 5% of calls)
    ├── Arbiter (cumulative risk scoring)
    ├── Chronicle (immutable audit trail)
    └── Beacon (cross-agent anomaly detection)
```

## Prerequisites

- **Node.js 20+** (zero npm dependencies)
- **Sentinel-Ops** (optional for local testing, required for production) — [contact us](https://yadriworks.ai) for access

## Quick Start

### Option A: Local Mode (no AWS, no API key)

Evaluate the full SOE enforcement locally — all rules execute from `.soe.json` definition files on disk.

```bash
git clone https://github.com/zenbuilder-yadri/sentinel-ops-insureco-demo.git
cd sentinel-ops-insureco-demo

# Run the full test suite (165 tests)
npm test

# Run the 14 demo scenarios
node demo/run-scenarios.js

# Launch the dashboard UI
npm start
# Open http://localhost:4000
```

### Option B: Connected Mode (Sentinel-Ops on AWS)

Connect to a live Sentinel-Ops instance for production-grade enforcement with AI reasoning, cumulative risk scoring, and immutable audit trail.

**Step 1: Deploy Sentinel-Ops in your AWS account**

Sentinel-Ops is deployed as a CloudFormation stack in your own AWS account. After purchase, you receive:
- A CloudFormation template that provisions the full Sentinel-Ops infrastructure (ECS Fargate, ALB, DynamoDB, Lambda, WAF)
- An API key for authentication

```bash
# Deploy the CFN stack (provided after purchase)
aws cloudformation create-stack \
  --stack-name sentinel-ops \
  --template-url https://your-cfn-template-url \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=ApiKey,ParameterValue=your-api-key
```

**Step 2: Configure environment**

```bash
export SOE_API_URL=https://your-sentinel-ops-endpoint
export SOE_API_KEY=your-api-key
```

**Step 3: Deploy SOE definitions**

Push the 4 agent SOE definitions to your Sentinel-Ops instance:

```bash
node deploy/deploy-soe.js
```

**Step 4: Run scenarios against live API**

```bash
# All 14 scenarios (now hitting real Sentinel-Ops API)
node demo/run-scenarios.js

# Single agent
node demo/run-scenarios.js --agent claims-bot

# Dashboard (connected to live API)
npm start
```

### What changes between Local and Connected mode?

| Capability | Local Mode | Connected Mode |
|-----------|------------|----------------|
| SOE enforcement (allow/deny/escalate) | Deterministic rules from `.soe.json` | Same rules + Sentinel AI for ambiguous cases |
| Audit trail | In-memory per session | Immutable, append-only DynamoDB + S3 |
| Cumulative risk scoring | Not available | Arbiter tracks risk across all agent actions |
| Cross-agent anomaly detection | Not available | Beacon correlates patterns across agents |
| Fail-closed behavior | Unknown tool → deny | Same + API unreachable → deny |
| Latency | <1ms | <1ms (95% deterministic), 2-5s (5% AI path) |

## Testing

### Unit Tests (165 tests, zero dependencies)

```bash
npm test
```

Validates every SOE assertion — positive and negative — for all 4 agents:

| Test File | What It Validates | Tests |
|-----------|-------------------|-------|
| `claims-bot.test.js` | Read/write claims, deny protected data, deny bash, approve/escalate logic | 31 |
| `underwrite-ai.test.js` | Risk scoring, Art.10/13 compliance, deny protected characteristics | 26 |
| `fraud-hunter.test.js` | Fraud signals, deny write claims, deny cross-tenant access | 28 |
| `policy-advisor.test.js` | Q&A responses, deny all writes, deny bash, fail-closed on unknown tools | 38 |
| `cross-agent.test.js` | Separation of duties, universal denies, deny-first evaluation, fail-closed | 28 |
| `audit-trail.test.js` | Audit entries on allow, zero side effects on deny, evaluation metadata | 20 |

### Demo Scenarios (14 scenarios)

```bash
# All agents
node demo/run-scenarios.js

# Single agent
node demo/run-scenarios.js --agent claims-bot
node demo/run-scenarios.js --agent underwrite-ai
node demo/run-scenarios.js --agent fraud-hunter
node demo/run-scenarios.js --agent policy-advisor
```

### Dashboard UI

```bash
npm start
# Open http://localhost:4000
```

Click **"Run All Scenarios"** to execute all 14 scenarios with visual results. Four tabs:
- **Dashboard** — agent fleet overview with SOE constraints and risk badges
- **Live Demo** — run scenarios, see allow/deny/escalate decisions in real-time
- **Compliance** — EU AI Act (9 articles) + NIST AI RMF (10 categories) mapping
- **Audit Trail** — filterable log of all SOE decisions

## Demo Scenarios (14 total)

### ClaimsBot — Auto-Adjudication

| # | Scenario | Expected | EU AI Act |
|---|----------|----------|-----------|
| 1 | Approve €2,800 claim (under €5K limit) | ALLOW | Art. 12 — logged |
| 2 | Escalate €12,500 claim (over limit) | ESCALATE | Art. 14 — human oversight |
| 3 | Approve €800 windshield claim | ALLOW | Art. 12 — logged |
| 4 | Read customer protected data | **DENY** | Art. 10 — data governance |

### UnderwriteAI — Risk Scoring

| # | Scenario | Expected | EU AI Act |
|---|----------|----------|-----------|
| 5 | Score low-risk customer (credit 742) | ALLOW | Art. 13 — transparent factors |
| 6 | Score high-risk customer (credit 655, 7 claims) | ALLOW | Art. 13 — transparent factors |
| 7 | Access ethnicity for underwriting | **DENY** | Art. 10 — protected characteristics |

### FraudHunter — Pattern Detection

| # | Scenario | Expected | EU AI Act |
|---|----------|----------|-----------|
| 8 | Analyze suspicious claim (rapid succession) | ALLOW | Art. 14 — flag, don't decide |
| 9 | Access another tenant's data | **DENY** | Data isolation |
| 10 | Modify a claim (unauthorized) | **DENY** | Read-only agent |

### PolicyAdvisor — Customer Chatbot

| # | Scenario | Expected | EU AI Act |
|---|----------|----------|-----------|
| 11 | Answer coverage question | ALLOW | Art. 52 — AI disclosure |
| 12 | Modify a policy | **DENY** | Read-only agent |
| 13 | Read claims data | **DENY** | Scope boundary |
| 14 | Execute system command | **DENY** | No bash access |

## SOE Definitions

Each agent has a JSON envelope in `soe-definitions/` that defines:

- **Identity** — role, authority level, environment scope
- **Data Access** — read/write allow/deny glob patterns
- **Tool Actions** — which tools/commands are permitted
- **Risk Budget** — cumulative risk threshold before envelope tightens
- **Classification** — EU AI Act risk level, relevant articles, NIST AI RMF categories

Example (ClaimsBot):
```json
{
  "agentId": "claims-bot",
  "classification": {
    "euAiAct": "high-risk",
    "annex": "III-5b",
    "articles": ["Art.6", "Art.12", "Art.14"]
  },
  "dataAccess": {
    "readAllow": ["data/claims/**", "data/policies/**", "data/customers/*"],
    "readDeny": ["data/customers/*/protected", "data/customers/*/protected/**"]
  }
}
```

## Compliance Matrix

See [docs/compliance-matrix.md](docs/compliance-matrix.md) for the full mapping of:
- EU AI Act articles to SOE constraints to demo scenarios
- NIST AI RMF functions to SOE implementation evidence
- Agent risk classification with specific obligations

## Project Structure

```
sentinel-ops-insureco-demo/
├── platform/
│   ├── server.js                 # Insurance SaaS API + Dashboard server
│   ├── soe-client.js             # Sentinel-Ops client (local + remote modes)
│   ├── soe-local.js              # Lightweight glob matching (zero deps)
│   ├── data/seed.js              # Mock customers, policies, claims
│   └── agents/
│       ├── claims-bot/           # Auto-adjudication (HIGH RISK)
│       ├── underwrite-ai/        # Risk scoring (HIGH RISK)
│       ├── fraud-hunter/         # Fraud detection (HIGH RISK)
│       └── policy-advisor/       # Customer chatbot (LIMITED RISK)
├── soe-definitions/              # SOE envelope per agent
│   ├── claims-bot.soe.json
│   ├── underwrite-ai.soe.json
│   ├── fraud-hunter.soe.json
│   └── policy-advisor.soe.json
├── dashboard/                    # Web UI (dark theme, 4 tabs)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── demo/
│   └── run-scenarios.js          # 14 demo scenarios (CLI)
├── tests/                        # 165 unit tests
│   ├── helpers.js                # Test framework + assertion helpers
│   ├── claims-bot.test.js
│   ├── underwrite-ai.test.js
│   ├── fraud-hunter.test.js
│   ├── policy-advisor.test.js
│   ├── cross-agent.test.js
│   └── audit-trail.test.js
├── docs/
│   └── compliance-matrix.md      # EU AI Act + NIST mapping
└── deploy/
    └── deploy-soe.js             # Deploy SOE definitions to Sentinel-Ops
```

## Key Design Principles

1. **Fail-closed** — if the SOE gate is unreachable, all agent actions are denied
2. **Deterministic enforcement** — glob/regex matching, no AI hallucination in the critical path
3. **Protected characteristics isolation** — underwriting cannot access ethnicity, disability, religion, or political affiliation at the data layer, not just policy
4. **Separation of duties** — FraudHunter can flag but not adjudicate; PolicyAdvisor can read but not write
5. **Human-in-the-loop** — claims above threshold are escalated, never auto-approved
6. **Transparent scoring** — every risk score includes factor breakdown and natural language explanation
7. **Immutable audit** — every SOE decision is logged; even the agents cannot modify the trail

## License

Apache 2.0

## Built With

- [Sentinel-Ops](https://yadriworks.ai/docs) — Safe Operating Envelope for AI Agents by [YadriWorks Inc.](https://yadriworks.ai)
- Node.js 20+ (zero external dependencies)
