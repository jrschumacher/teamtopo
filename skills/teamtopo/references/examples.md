# Worked examples

One edit per bundled example in `examples/`. Each shows the user's prompt, the
reasoning that picks the recipe, and the exact diff. Every "after" file was run through
`node src/cli.js --json`, `node src/cli.js` (SVG) and `node src/cli.js --api` and
exits 0; the diffs are reproduced verbatim from those files.

## `examples/minimal.tt`: add an enabling team

**Prompt:** "Add a security team that helps the product team with threat modelling."

**Reasoning:** an enabling team (`references/edits.md`, "Add an enabling team").
Declared at top level, where the lane it helps is declared, and after the stream so
the overlay column is read after the lanes. One facilitating line with a label.

```diff
--- a/examples/minimal.tt
+++ b/examples/minimal.tt
@@ -1,4 +1,6 @@
 teamTopology
   stream app "Product Team"
+  enabling security "Security"
   platform infra "Platform"
   infra --> app
+  security ~~> app : threat modelling
```

## `examples/ecommerce.tt`: split a team

**Prompt:** "Split Checkout into two stream-aligned teams: Cart, and Payment Checkout
which takes over the Payments API integration."

**Reasoning:** "Split a team into two". Two fresh ids (`cart`, `pay`) replace
`checkout` in the same position, splitting `size`. Every line naming `checkout` is
rewritten: the infra fan-out now lists both halves, the Payments API goes to `pay`
only, DevEx facilitates both. A temporary collaboration between the halves with a
duration records the handoff. The `api checkout` block becomes `api pay` (it keeps
`checkout-service` and the payments migration), and `cart` gets a short block for
`cart-ui`. Validation would fail with `unknown team "checkout"` if any reference were
missed.

```diff
--- a/examples/ecommerce.tt
+++ b/examples/ecommerce.tt
@@ -4,7 +4,8 @@
   legend
 
   %% Stream-aligned teams own a slice of the product end to end
-  stream   checkout   "Checkout"            [size=7]
+  stream   cart       "Cart"                [size=4]
+  stream   pay        "Payment Checkout"    [size=4]
   stream   search     "Search & Discovery"  [size=6]
   stream   accounts   "Accounts & Identity" [size=5]
 
@@ -19,22 +20,28 @@
   platform  payments  "Payments Platform"
 
   %% Interactions
-  infra    --> checkout, search, accounts : Kubernetes & CI [duration=ongoing]
-  payments --> checkout                   : Payments API
+  infra    --> cart, pay, search, accounts : Kubernetes & CI [duration=ongoing]
+  payments --> pay                        : Payments API
   ranking  --> search                     : Ranking API
   search   <--> ranking                   : new signals
-  devex    ~~> checkout, accounts         : CI pipelines [duration="until Q3"]
+  devex    ~~> cart, pay, accounts        : CI pipelines [duration="until Q3"]
+  cart     <--> pay                       : basket-to-payment handoff [duration="until Q4"]
 
   %% Expected soon: drawn dashed, listed under "teams we expect to interact with soon"
   search <--> accounts : personalised results [soon, duration="8 weeks"]
 
   %% Team API fields the diagram cannot infer (see the Team API panel / --api)
-  api checkout {
-    focus: the checkout experience end to end
-    software: checkout-service, cart-ui
+  api cart {
+    focus: the basket and cart experience
+    software: cart-ui
+    chat: #cart
+  }
+  api pay {
+    focus: taking payment for the basket
+    software: checkout-service
     SLE: 99.9% availability, p95 < 300 ms
     versioning: semver, two releases of deprecation notice
-    wiki: checkout, cart, basket
+    wiki: checkout, payment, basket
     chat: #checkout #checkout-alerts
     sync: 09:30 UTC
     working on: migrating to the new payments API
```

## `examples/platform-grouping.tt`: add a platform

**Prompt:** "Add a Data Platform team that provides analytics events to both
storefront teams."

**Reasoning:** "Add a platform". A plain platform (one team, no block) is declared at
top level with a `note`, before the `cloud` platform grouping so the file reads top
down the way the picture does (leaf platform bars are drawn above platform groupings
regardless). One fan-out line provides to both lanes; it draws as one wedge.

```diff
--- a/examples/platform-grouping.tt
+++ b/examples/platform-grouping.tt
@@ -6,6 +6,9 @@
   stream web    "Web Storefront"
   enabling sre  "SRE Coaching"
 
+  %% A plain platform team: one full-width bar beneath the lanes
+  platform data "Data Platform" [note="events, warehouse"]
+
   %% A platform can itself be a topology of teams
   platform cloud "Cloud Platform" {
     stream    k8s   "Kubernetes"
@@ -19,5 +22,6 @@
 
   k8s --> mobile, web       : runtime
   obs --> mobile, web       : dashboards & alerts
+  data --> mobile, web      : analytics events
   sre ~~> web               : incident reviews
   mobile <--> web           : shared design system
```

## `examples/value-streams.tt`: mark an interaction as expected soon

**Prompt:** "Security Enablement hasn't started with Catalog yet. Mark that as expected
soon; it should take about six weeks."

**Reasoning:** "Mark an interaction as expected soon". The facilitation was a fan-out
to two lanes and only one of them is "soon", so the fan-out is split into two lines and
`[soon, duration="6 weeks"]` goes on the Catalog line. Storefront stays solid.

```diff
--- a/examples/value-streams.tt
+++ b/examples/value-streams.tt
@@ -19,4 +19,5 @@
 
   core --> storefront, fulfilment, catalog, invoicing
   tax  --> invoicing, storefront : tax rules API
-  security ~~> catalog, storefront : threat modelling
+  security ~~> storefront : threat modelling
+  security ~~> catalog    : threat modelling [soon, duration="6 weeks"]
```

## `examples/org-groups.tt`: add a stream inside a group

**Prompt:** "Add a Mobile team to the Customer Group. It uses the Frontend Platform
and gets UX Research coaching like the others."

**Reasoning:** the new lane belongs in `group customer { }`, so it is declared inside
that block, after `billing` (bottom lane of the group). The two interactions that
should include it are inside the same block and are fan-outs, so `mobile` is appended
to each rather than adding new lines: the frontend wedge and the UX bar both extend to
cover it.

```diff
--- a/examples/org-groups.tt
+++ b/examples/org-groups.tt
@@ -6,6 +6,7 @@
     stream business "Business"
     stream success  "Customer Success"
     stream billing  "Billing"
+    stream mobile   "Mobile"
     subsystem data1 "Data"
     subsystem sec1  "Security"
     enabling ux1    "UX Research"
@@ -13,8 +14,8 @@
 
     data1 --> accounts
     sec1  --> accounts
-    frontend --> accounts, billing
-    ux1 ~~> accounts, business, success, billing
+    frontend --> accounts, billing, mobile
+    ux1 ~~> accounts, business, success, billing, mobile
   }
 
   group content "Content Group" {
```

## From scratch: two streams, a platform, then an enabling team

**Prompt:** "Create a topology with two stream teams and a platform, then add an
enabling team for security."

**Reasoning:** "Create a topology from scratch", then "Add an enabling team". Streams
first (lanes, in order), platform beneath with one fan-out, enabling team declared at
top level with the lanes it helps and one facilitating line.

```
teamTopology
  title Web product
  flow
  legend

  stream   storefront "Storefront"
  stream   accounts   "Accounts"
  enabling security   "Security"
  platform core       "Core Platform" [note="identity, hosting, CI"]

  core     --> storefront, accounts : hosting & CI
  security ~~> storefront, accounts : threat modelling
```
