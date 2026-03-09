---
title: "Refitting BVHs for Soft-Body Collision"
description: "Quantifying and improving the performance of Bounded Deformation Trees, the structures allowing output-sensitive collision detection for deformable models."
pubDate: "Jan 11 2026"
heroImage: "../../assets/bdtree/bunny-layer10-bvh.png"
---

Collision detection is the invisible backbone of physical simulation. In rigid body dynamics, we have it mostly figured out. Physics engines can handle thousands of tumbling boxes with ease because the shape of a box never changes. But as soon as objects start to squish, bend, or twist, the complexity explodes.

For my recent research project, I explored **Bounded Deformation Trees (BD-Trees)**. This algorithm is designed to make collision detection for deformable models fast enough for real-time applications. While efficient, BD-Trees have a hidden cost: they are "looser" than they need to be.

In this post, I will walk through how BD-Trees work, why their mathematical guarantees lead to wasted performance, and the results of my experiments quantifying exactly how much "slack" is in the system.

## The Problem with Squishy Objects

In standard rigid body simulation, you can pre-calculate a bounding volume hierarchy (BVH) once. When the object moves, you simply rotate and translate the bounding boxes.

For a deformable object, such as a rubber bunny or a bending pipe, the shape changes every frame. If you have a high-resolution mesh with thousands of triangles, re-fitting a BVH every single frame is computationally expensive.

You essentially have two choices:

1.  **Rebuild:** Recompute the bounds every frame (Slow, but tight bounds).
2.  **Refit:** Update the existing bounds (Faster, but bounds degrade or become loose over time).

## The Solution: Reduced Deformation Models & BD-Trees

BD-Trees rely on **Reduced Order Models (ROMs)**. Instead of simulating every single vertex independently, we approximate the deformation as a linear combination of a few vibration modes. Think of these as the natural wobble of a bridge or the fundamental frequencies of a guitar string.

We precompute a 3D model's modes using a **Modal Analysis** algorithm, such as **Principal Component Analysis (PCA)** or **Generalized Eigenvalue Problem (GEVP)**. The modes are put into a matrix $U$ and used to compute the deformed position of each vertex $p'$ at runtime.

Mathematically, the deformed position $p'$ is expressed as:

$$
p' = p + Uq
$$

Where:

- $p$ is the rest position of the vertices in the mesh.
- $U$ is the deformation basis (the precomputed shapes/modes).
- $q$ is the vector of reduced coordinates (the amplitude of each mode at runtime).

### The $O(r)$ Update Trick

The genius of the BD-Tree is that it allows us to update the bounding volumes of our BVH in $O(r)$ time, where $r$ is the number of modes (usually small, like 20-30). This cost is independent of the mesh complexity.

We can compute the new center $c'$ and radius $R'$ of a bounding sphere[^6] directly from $q$:

$$
c' = c + \bar{U}q
$$

$$
R' = R + \sum_{j=1}^{r} \Delta R_j |q_j|
$$

![TODO: Image of BD-Tree hierarchy levels on a bunny model, showing Layers 0, 1, and 10]
_Fig 1: Visualizing the Bounding Volume Hierarchy levels on the Stanford Bunny <cite>Lefebvre (2025)[^1]</cite>._

## The "Slack" Problem

The formula above is fast, but it introduces a problem. Look closely at the radius update: $R' = R + \sum \Delta R_j |q_j|$.

It uses the absolute value $|q_j|$. This relies on the **Triangle Inequality** to guarantee that the new sphere _definitely_ encloses the geometry. It conservatively assumes that every active deformation mode is pushing geometry _outward_, effectively expanding the sphere.

In reality, modes often shrink geometry or move points closer to the center. The BD-Tree update does not account for this; it always grows the sphere to be safe. I call this "Slack." It is the difference between the BD-Tree's safe radius and the actual optimal radius needed to wrap the geometry.

![TODO: Image comparing naive sphere bounds vs optimal bounds, showing the gap or 'slack' between them]
_Fig 2: The "Slack" problem. The calculated bound grows significantly larger than the blue object inside <cite>Lefebvre (2025)[^2]</cite>._

## Experiment: Quantifying the Conservativeness

I wanted to measure exactly how bad this overestimation gets. I implemented a BD-Tree pipeline using <a href="https://github.com/wildmeshing/fTetWild">`fTetWild`</a> for tetrahedralization and <a href="https://github.com/Q-Minh/PhysicsBasedAnimationToolkit">`PBAT`</a> for FEM analysis.

I ran experiments on several meshes—including the Stanford Bunny, Spot the Cow, and the Thingi10k Arc—subjecting them to random deformations. I then compared the BD-Tree radius $R_{estimate}$ to the true brute-force optimal radius $R_{optimal}$.

### 1. Energy vs. Conservativeness

My data showed that the "looseness" of the bounds scales with the energy of the deformation. As you deform the object more, the BD-Tree expands the bounds aggressively.

The relationship roughly follows a square root function relative to deformation energy.

![TODO: Graph of Conservativeness Ratio vs Deformation Energy for 'Spot' model]
_Fig 3: As deformation energy increases, the conservativeness ratio (BD-Tree Radius / Optimal Radius) climbs <cite>Lefebvre (2025)[^3]</cite>._

### 2. The Shape Matters

Not all geometry behaves the same.

- **The Bunny:** This model showed a "bimodal" distribution. The ears, which flap around, resulted in very loose bounds, while the rigid body stayed relatively tight.
- **The Arc:** This long, thin shape suffered the most. Because the BD-Tree is built on spatial proximity in the _rest pose_, it groups the tips of the arc together. When the arc bends, those tips move far apart. This breaks the spatial assumption and causes massive overestimation.

![TODO: Heatmap of error distribution on the Arc model]
_Fig 4: Heatmap showing absolute radius error on the Arc model. Note how the error decreases with tree depth <cite>Lefebvre (2025)[^4]</cite>._

## Future Ideas: Building Better Trees

The standard BD-Tree is built by grouping triangles that are close to each other in 3D space, known as Euclidean distance.

My research suggests this is a flaw for deformable objects. Just because two triangles are close (like two fingers touching) does not mean they move together. If they move in opposite directions, their parent bounding sphere has to grow significantly to encompass both.

**The Fix?** We should construct the tree based on **Deformation Coherence** or Geodesic distance. We should group parts of the mesh that _move_ together, not just parts that _sit_ together.

![TODO: Diagram contrasting Euclidean vs Geodesic distance on a curved surface]
_Fig 5: Using geodesic distance or modal correlation to build the tree could prevent "fighting" geometry from sharing the same leaf node <cite>Lefebvre (2025)[^5]</cite>._

## Conclusion

BD-Trees are a powerful tool for getting reduced deformable models running in real-time. However, the standard implementation leaves performance on the table by being overly conservative.

By understanding where this "slack" comes from—specifically the triangle inequality and the tree construction method—we can start designing smarter trees. Tighter bounds mean we can cull more collisions early, making our simulations faster and more accurate.

---

### References

[^1]: Image derived from <cite>Lefebvre (2025)</cite>.

[^2]: Concept illustrated in <cite>Lefebvre (2025)</cite>.

[^3]: Data visualization from <cite>Lefebvre (2025)</cite>.

[^4]: Data visualization from <cite>Lefebvre (2025)</cite>.

[^5]: Concept derived from <cite>Lefebvre (2025)</cite>.

[^6]: This article uses bounding spheres as the example because they're simpler and easier to reason about, but AABBs actually perform better in practice due to their tighter bounds, even though they require more work to update.
