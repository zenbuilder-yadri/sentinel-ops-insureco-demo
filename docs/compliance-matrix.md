# InsureCo AI Compliance Matrix

## EU AI Act Mapping

| Article | Requirement | Agent(s) | SOE Enforcement | Demo Scenario |
|---------|------------|----------|-----------------|---------------|
| **Art. 6** | Risk classification of AI systems | All | `classification.euAiAct` field in SOE definition | SOE definitions classify each agent as high-risk or limited-risk |
| **Art. 9** | Risk management system | All | Risk budgets with cumulative scoring, decay, and envelope tightening | Arbiter monitors cumulative risk across all agents |
| **Art. 10** | Data governance | UnderwriteAI | `readDeny` blocks `data/customers/*/protected/**` | Scenario 7: ethnicity access blocked |
| **Art. 12** | Record-keeping | All | Chronicle audit trail — every SOE decision logged immutably | All scenarios produce audit entries |
| **Art. 13** | Transparency | UnderwriteAI, PolicyAdvisor | Evaluate response includes `reason` field; risk scores include `factors` and `explanation` | Scenario 5-6: scoring factors returned |
| **Art. 14** | Human oversight | ClaimsBot, FraudHunter | Claims above auto-approve limit escalated; fraud flags require human review | Scenario 2: €12,500 claim escalated |
| **Art. 15** | Accuracy, robustness, cybersecurity | All | Deterministic pre-filter (no hallucination); fail-closed on gate unreachable | soe-client.js returns deny on network failure |
| **Art. 52** | Transparency for limited-risk AI | PolicyAdvisor | `aiDisclosure` field in every response | Scenario 11: AI disclosure included |
| **Art. 72** | Post-market monitoring | All | Beacon cross-agent anomaly detection | Beacon monitors for drift and anomalies |

## NIST AI Risk Management Framework (AI 100-1) Mapping

| Function | Category | SOE Implementation | Evidence |
|----------|----------|-------------------|----------|
| **GOVERN 1.1** | Legal and regulatory requirements identified | SOE definitions include `classification.euAiAct` and `classification.articles` | All 4 SOE definitions |
| **GOVERN 1.2** | Trustworthy AI characteristics integrated | Fail-closed design, bounded authority, immutable audit | soe-client.js, Chronicle |
| **MAP 1.1** | Intended purpose documented | SOE `description` and `identity.role` fields | SOE definitions |
| **MAP 2.1** | AI risks mapped to specific contexts | `classification.annex` maps to EU AI Act Annex III categories | SOE definitions |
| **MAP 3.1** | Benefits and costs of AI assessed | Fraud detection balances automation benefit vs. profiling risk | FraudHunter SOE: tight risk budget (60) |
| **MEASURE 2.3** | AI system fairness assessed | Protected characteristics blocked at data access layer | UnderwriteAI readDeny patterns |
| **MEASURE 2.5** | AI system explainability characterized | Risk scores include factor breakdown and natural language explanation | UnderwriteAI `_computeRiskScore` output |
| **MEASURE 2.6** | AI system reliability assessed | Deterministic rules handle 95% of decisions; risk budgets cap cumulative exposure | Pre-filter + Arbiter |
| **MANAGE 1.3** | Responses to identified risks deployed | SOE deny rules block prohibited actions; escalation for ambiguous cases | All deny scenarios |
| **MANAGE 2.1** | AI risks monitored | Arbiter tracks cumulative risk; Beacon detects anomalies | Risk budget configuration per agent |
| **MANAGE 2.2** | Mechanisms for feedback incorporated | Audit trail enables post-hoc review; human-in-the-loop for escalations | Chronicle + escalation path |

## Agent Risk Classification

| Agent | EU AI Act Class | Annex III | Key Obligations | SOE Controls |
|-------|----------------|-----------|-----------------|--------------|
| **ClaimsBot** | High Risk | §5(b) — insurance | Art.12 record-keeping, Art.14 human oversight | Auto-approve limit, write restricted to claims, bash denied |
| **UnderwriteAI** | High Risk | §5(b) — credit scoring | Art.10 data governance, Art.13 transparency | Protected data denied, explainable scoring, write restricted to risk-assessments |
| **FraudHunter** | High Risk | §5(a) — profiling | Art.14 human oversight, Art.12 record-keeping | Read-only + flags, cross-tenant denied, cannot adjudicate |
| **PolicyAdvisor** | Limited Risk | N/A | Art.52 transparency | Read-only, no claims/fraud/risk access, no bash, AI disclosure in responses |

## SOE Constraint → Compliance Traceability

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌────────────────────┐
│ EU AI Act Article    │────▶│ SOE Constraint           │────▶│ Demo Scenario      │
├─────────────────────┤     ├──────────────────────────┤     ├────────────────────┤
│ Art.10 Data Gov.     │────▶│ readDeny: */protected/** │────▶│ #7 ethnicity block │
│ Art.14 Human Oversig │────▶│ autoApproveLimit: 5000   │────▶│ #2 claim escalated │
│ Art.52 Transparency  │────▶│ aiDisclosure in response │────▶│ #11 AI identified  │
│ Art.12 Record-keeping│────▶│ Chronicle audit trail    │────▶│ All scenarios      │
│ Art.15 Robustness    │────▶│ fail-closed on error     │────▶│ soe-client.js      │
└─────────────────────┘     └──────────────────────────┘     └────────────────────┘
```
