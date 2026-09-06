---
title: Agentic Teams on Team Topologies
date: 2026-09-05
author: Ryan Schumacher
summary: Most agentic-team proposals are new and unmeasured, so this model builds on what is already known about organization shape, cognitive load, and the measured effects of AI-assisted development.
tags: team-topologies, ai-agents, org-design
---

A working model for adding AI coding agents to an engineering organization without discarding what is already known about team design, cognitive load, and Conway's Law.

## Premise

Most "agentic team" proposals are new and unmeasured. What is measured is older and more stable:

- The shape of an organization drives the shape of its architecture (Conway).
- Team cognitive load is the binding constraint on how much a team can own well (Sweller; Skelton and Pais).
- AI-assisted development has, so far, raised throughput while lowering delivery stability (DORA 2024, 2025, 2026; Faros 2026).

The model below treats agents as something teams *have*, not something teams *are*. This is consistent with the direction the Team Topologies authors have taken themselves: Skelton and Pais now describe the framework as the "infrastructure for agency," arguing that organizations already designed around bounded agency for humans are the ones positioned to adopt AI agents well, because the same constraints (independently viable services, cognitive load as a design limit, clear service interfaces) are what give agents their guardrails.

The model is presented in three stages so that each can be adopted and measured independently.

---

## Agents, defined

Team Topologies cautions against adding team types or hybrids. That caution is about *topology*: what the org's units are and how they interact. It does not prohibit describing what a team is made of, which the framework already does for humans, Team APIs, and interaction modes. An agent is a new element in a team's composition, and the research already describes its effects. Leaving it undefined does not keep the model pure; it leaves a vacuum that ad hoc structures fill.

In this model, an agent is defined by three properties, each of which follows from the evidence rather than from preference:

| Property | Definition | Grounding |
|---|---|---|
| **Scope** | An agent's write scope is bounded by the ownership boundary of the team it belongs to. It cannot modify what its team does not own. | Conway's Law; TT independent-service boundaries; stability degrades most when agents lack institutional context |
| **Accountability** | An agent carries none. Every agent action resolves to a named human on the team that operates the affected system. | TT "you build it, you run it"; ownership defined by who is paged |
| **Load** | An agent does not add capacity to a team. It converts writing load into verification load, drawing on the team's existing cognitive budget. | DORA verification tax and J-curve; Faros review-time and unreviewed-merge telemetry; METR perceived-versus-actual speed gap |

Two consequences follow directly:

- **An agent cannot be an owner.** Ownership requires accountability, and an agent has none. Any model in which maintenance of a system falls to "whoever's agent last touched it," or to a body that owns guidance rather than operations, has no owner at all.
- **Agents are not a fifth team type.** They are a property of the four existing types, drawn as annotations on the team shape. A team's type is unchanged by how many agents it runs.

**Non-goals.** This model does not propose agent-only teams, agents as members of guilds, or agents holding cross-team write access. Each of those would require an agent to hold scope or accountability it does not have.

---

## Stage 0: What agents do to humans

Before adding agents to an org design, account for what they do to the people already in it.

**Cognitive load shifts from writing to verifying.** Agents reduce the extraneous load of producing code and increase the load of checking it. DORA's 2026 research names this the *verification tax* and describes an adoption J-curve: a real productivity dip before gains, driven by learning cost, integration friction, and review overhead.

**Throughput up, stability down.** The 2025 DORA report found AI adoption positively correlated with throughput and negatively correlated with delivery stability, and framed AI as an amplifier of existing organizational strengths and weaknesses rather than a fix for them.

**Review is the new bottleneck.** Faros telemetry across roughly 22,000 developers (2026) reports median PR review time up 441%, PR size up about 51%, 31% more PRs merging with no review, bugs per developer up 54%, and incidents per PR up roughly 243% versus the prior year. They call the pattern *acceleration whiplash*: gains at the point of generation, compounding costs at every stage after it.

**Perceived speed and actual speed diverge.** METR's 2025 randomized trial found experienced open-source developers were about 19% slower on their own repositories when using AI tools, while believing they were roughly 20% faster.

**Oversight cost scales with agent count.** Each additional agent adds supervision load to the humans responsible for its output.

**Implications for org design:**

1. Ownership must stay with humans who carry accountability for running the code, or the verification tax has no one to pay it.
2. A team's concurrent agent work should be capped by its review capacity, not its generation capacity.
3. A team's ownership surface should not expand simply because agents can reach further.
4. "Everyone can build on everything" was a coordination cost before agents. With agents it becomes a coupling multiplier: cheap to produce, expensive to own, and the maintainer of record becomes the last agent to touch it.

---

## Stage 1: Agents inside the existing topology

No new team type. Team Topologies explicitly cautions against adding types or hybrids. Instead, every agent belongs to a team and inherits that team's boundary, Team API, and interaction modes.

**Stream-aligned teams** own code, run it, and own their agents. The ownership test is unchanged: the team that gets paged owns the system. Two kinds of agent attach here:

- **Coding agents, one per human.** Each engineer drives their own agent. The agent's write scope equals the team's ownership scope. A change to another team's code is a pull request into that team's repository, reviewed by that team, exactly as a human's would be.
- **A reviewing agent, singular.** One review agent attached to the team's CI pipeline. It reads every PR against the team's conventions and the guild guidance below. It flags; it does not merge. Merge remains a human decision by the owning team.

**Guilds** are enabling teams. They own guidance, not code. In an agentic organization this becomes concrete: a guild owns the agent context files, skills, linters, and CI policy for its domain (a language, security, API design, accessibility). Guild output is consumed by every team's reviewing agent. Guilds are never paged, so they never own systems.

**Complicated-subsystem teams** keep their specialist ownership and get tiered agent autonomy. Where blast radius is high (cryptography, key management, billing, safety-critical paths), agents draft and humans gate. Autonomy is a property of the domain, not the tool.

**Interaction modes carry over unchanged:**

- *Collaboration* is time-boxed and should end by producing a Team API plus shared agent context.
- *X-as-a-Service* means an agent consumes another team's service and never modifies it.
- *Facilitating* is what guild guidance does when it lands in another team's reviewing agent.

### Illustration

Agents are drawn as annotations on existing shapes, not as new shapes.

```
Legend
  [ Team ]        stream-aligned team (owns code, runs it, gets paged)
  { Guild }       enabling team (owns guidance-as-code, never paged)
  ( Subsystem )   complicated-subsystem team (specialist ownership, tiered autonomy)
  * per-human coding agent, scoped to the team's ownership boundary
  R  singular reviewing agent attached to the team's CI; flags, never merges
  -->  X-as-a-Service (consume, never modify)
  ~~>  facilitating (guidance flows in)


   { Language Guild }      { Security Guild }
      context, lint          policy, checks
           ~~~~~~~~~~~~\  /~~~~~~~~~~~~
                        \/
   [ Team A ]           R           [ Team B ]
    * * * *  ---- CI --------> ----  * * *
    owns svc A                       owns svc B
                                          |
                                          v
                                 ( Crypto Subsystem )
                                   * (draft only)
                                   human gate
```

Reading it: each human on Team A has a coding agent (`*`). Team A has one reviewing agent (`R`) in CI that applies guild guidance. Team A's agents can call Team B's service but cannot change it; a change to service B is a PR into Team B, reviewed by Team B. The crypto subsystem's agents draft only.

---

## Stage 2: The agent platform

Today most organizations have, at best, an AI gateway, while every developer runs their own coding harness. That is a pre-platform state, analogous to every team running its own CI before a shared pipeline existed.

The future model adds a **platform team** that owns a single agent harness which all humans drive. Following the *thinnest viable platform* principle, it owns only what stream teams should not each solve alone:

- model access and routing
- sandboxes and execution boundaries
- shared tool integrations (for example, MCP servers)
- evaluation harnesses for agent output
- audit, provenance, and cost visibility

Stream teams consume the platform as a service. Guilds publish guidance into it. The reviewing agent becomes a platform capability configured per team rather than a per-team build.

```
                { Guilds } ~~> guidance-as-code
                                  |
                                  v
        +-------------------------------------------+
        |   Agent Platform (platform team, TVP)     |
        |   harness . sandboxes . eval . audit      |
        +-------------------------------------------+
            ^ as-a-service        ^ as-a-service
            |                     |
        [ Team A ]            [ Team B ]
         * * * *  R            * * *  R
```

This stage should not be forced early. Docker's case study is instructive: they deferred platform teams while resource-limited, gave stream teams a large off-roadmap allowance instead, and formed platform teams only once growth funded them. Under deadline pressure they also repeatedly slid back into siloed, borrowed-resource patterns, which is the same pressure an agentic push creates.

---

## Evidence versus hypothesis

Not everything above carries the same weight. This table separates what the research supports from what this model proposes and has not yet measured. The hypotheses are the pilot; the evidence is why the pilot is shaped the way it is.

| Claim | Status | Basis | What would confirm or kill it |
|---|---|---|---|
| Org shape drives architecture | Evidence | Conway 1968; TT | Long established |
| Cognitive load bounds what a team can own well | Evidence | Sweller; Skelton and Pais | Long established |
| AI raises throughput and lowers delivery stability | Evidence | DORA 2024, 2025, 2026 | Ongoing annual measurement |
| Review is the bottleneck after AI adoption | Evidence | Faros 2026 telemetry; DORA 2026 verification tax | Team-level review-time and unreviewed-merge data |
| Perceived and actual speed diverge with AI tools | Evidence | METR 2025 RCT | Replication at larger scale |
| Bounded agency for humans transfers to agents | Authors' position | Skelton and Pais, "infrastructure for agency" | Field evidence from TT-shaped orgs adopting agents |
| Agent scope equals team ownership scope | Derived | Follows from Conway plus the accountability property | Orphaned-change rate stays near zero in pilot |
| Guilds own guidance-as-code, never code | Derived | TT enabling-team pattern applied to agent context | Guild output measurably consumed by reviewing agents; no guild-owned systems |
| One coding agent per human | Hypothesis | Reasonable default; unmeasured | Pilot: throughput without review or stability degradation at that ratio |
| One reviewing agent per team, in CI, flag-not-merge | Hypothesis | Matches current common practice; unmeasured | Pilot: unreviewed-merge rate falls; change failure rate does not rise |
| Agent concurrency capped by review capacity | Hypothesis | Derived from review-bottleneck evidence; cap value unmeasured | Pilot: review time and PR size hold flat as agent use rises |
| A platform team owning a single harness | Hypothesis | TT platform-as-product; Docker's sequencing | Deferred until Stage 1 data exists |

---

## Measuring it

Because agentic-team data is what is missing, the model is a pilot with instrumentation, not a reorganization. Start with one stream-aligned team, per the small-and-safe-changes principle.

**Delivery (DORA five-metric model):** deployment frequency, lead time, change failure rate, time to restore, deployment rework rate.

**Review health:** PR size, review time, percentage of PRs merged without human review.

**Ownership health:** orphaned-change rate (merged changes no team claims), cross-boundary PR count and outcome.

**Human load:** a team cognitive-load survey, repeated at a fixed cadence, before and after agents are introduced.

Success is not throughput. Success is throughput without the stability and review degradation the current data predicts.

---

## Summary

- Agents inherit the topology; they do not get their own. No new team type.
- Ownership stays with the team that gets paged. Agent write scope equals team ownership scope.
- Guilds own guidance-as-code and feed reviewing agents. They never own code.
- Stage 1: one coding agent per human, one reviewing agent per team in CI, flag-not-merge.
- Stage 2: a platform team owning a single harness as a thinnest viable platform.
- Review capacity, not generation capacity, sets the limit on agent concurrency.
- Measure before scaling.

---

## References

**Organizational design**

- Skelton, M. and Pais, M. *Team Topologies: Organizing Business and Technology Teams for Fast Flow.* IT Revolution, 2019. Key concepts, nine principles, six patterns, and the caution against adding team types: teamtopologies.com/key-concepts
- Conway, M. "How Do Committees Invent?" *Datamation*, 1968. Origin of Conway's Law.
- Docker case study: "Rebuilding and scaling product development at Docker using Team Topologies." teamtopologies.com industry examples, 2022; companion post on the Docker blog, "Building Stronger, Happier Engineering Teams with Team Topologies."

**Cognitive load**

- Sweller, J. "Cognitive Load During Problem Solving." *Cognitive Science*, 1988. Intrinsic, extraneous, and germane load.
- Skelton and Pais, above, on team cognitive load as the sizing constraint for team responsibilities.

**AI-assisted development outcomes**

- DORA, *Accelerate State of DevOps Report*, 2024. AI adoption associated with reduced throughput and stability.
- DORA, *State of AI-Assisted Software Development*, 2025. AI positively correlated with throughput, negatively with stability; AI as amplifier; DORA AI Capabilities Model; seven team archetypes.
- DORA, *The ROI of AI-Assisted Software Development*, 2026. Adoption J-curve, verification tax, worked example of change failure rate rising after adoption. dora.dev
- DORA, transition from four keys to the five-metric model including deployment rework rate, 2026. dora.dev/insights
- Faros AI, *AI Engineering Report*, 2026. Telemetry across roughly 22,000 developers: review time, PR size, unreviewed merges, bugs per developer, incidents per PR. "Acceleration whiplash."
- METR, "Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity," 2025. Randomized trial; experienced developers slower with AI tools while perceiving themselves faster.
