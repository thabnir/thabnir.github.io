# TODOS

## Boids Article

### Improvements

#### Writing

- Better narrative flow, less disjointed sections
- Decide whether to include code in the article.
- Talk about paramter tuning in the article.

Read some other articles on the topic to get ideas for how to improve the article. See what they did well and what they did poorly. Most of them are non-interactive, old, and ugly, but still have some good ideas / insights. They're more like teaching tools or textbooks.

[Stanford](https://cs.stanford.edu/people/eroberts/courses/soco/projects/2008-09/modeling-natural-systems/boids.html): really old, has a few nice static visualizations, but no interactivity or demo.

[Ben Eater](https://eater.net/boids): has a demo, but it's not nearly as nice as mine. The article is also totally separate from the demo and feels disconnected.

[kfish pseudocode](http://www.kfish.org/boids/pseudocode.html): this is a good reference for the algorithm, but it's not interactive and doesn't have any visualizations (or demo or pictures).

[Sebastian Lague](https://www.youtube.com/watch?v=bqtqltqcQhw): awesome video, but it's a video, not an interactive article. Worth watching for inspiration!

- Has obstacle avoidance and 3D boids

[Abzu Technical Art](https://www.youtube.com/watch?v=l9NX06mvp2E): goes over how Abzu simulates fish and sharks in its game. Since it's a full game, it has a lot of detail on how to make it look good and perform well.

- Lots of details on animating instanced meshes without skeletons (runs like 30,000 fish at 60fps)
- Talks about how to warp a creature's mesh to warp smoothly as it follows a curved path

[Useless Game Dev](https://www.youtube.com/watch?v=6dJlhv3hfQ0): has very fast, clear explanations of each step, and chooses parameters that make the boids actually demonstrate the core of each rule very clearly (alignment quickly aligns everything, cohesion has an immediate jostling effect, etc). Good writing.

#### Visuals & Interactivity

Use same style of zoomed-in view as "Separation" section in other sections.

- Can make the final simulation into a big reveal after looking at only the zoomed-in views.
- Reveal could be similar to the current zoom-out in the Playground section.

Add better visualizations for Alignment and Cohesion.

- Alignment should show the boids' headings as well as the average heading of the neighbors as a sort of "desired" heading for the highlighted boid
- Cohesion should show the center of mass of the neighbors and an arrow to it as a sort of "desired" position for the highlighted boid.
- Could maybe scale the arrows based on the parameter values.

Add better explanation and visualization of spatial hash grids.

- Show the grid cells and the boids in each cell.
- Show that we only need to check neighbors in the same cell and the cells immediately surrounding the highlighted boid.
- Add a "loop" demo that highlights one boid at a time for every boid vs only those in adjacent cells to illustrate the difference in performance.

Bonus features:

- Add simple interactive parameter tuning sections for each section to allow users to experiment with the parameters and see the effects on the simulation.
- Add option to loop around the screen instead of bouncing off the edges.
- Add predator boids to the simulation.
- Add species to the simulation (each species only interacts with its own species)
- Add obstacles / obstacle avoidance to the simulation (see Sebastian Lague's video for inspiration)
- Add parameter presets / preset saving / preset loading
  - Experiment with different parameter values and save the best ones

#### Stretch / followup article

- Make a WebGPU compute shader version of the simulation with a ton of boids (doesn't have to have all the features of the current simulation, just a basic version that shows the core idea)
- Make a 3D version of the simulation (probably based on the WebGPU compute shader version for performance)
  - Make boids use sprites or meshes (instanced) instead of just triangles so they look like proper fish or birds

### Bugs

#### Mobile

- Boid's-Eye View section has broken vertical padding
- Playground settings menu overlaps with "Experiment" label

#### Width issue for quotes vs body text

Quote is way wider than body text in section 1

![alt text](<Screenshot 2026-01-11 at 5.51.17 AM.png>)

## BD-Trees Article

### Immediate

- Add the images / visualizations.

### Soon

- Add math for delta R and ubar calculations
- Add math for modal analysis / basis construction
- Add math for runtime physics
- Talk about different construction strategies (median vs SAH)
- Improve writing quality

### Later

- Add more experiments and analysis
- Add a comparison to other deformable collision methods (LBVH)
- Add demo code from `web_bdtree` project (WIP)

## Fonts

Normal:

- **Helvetica Neue** (current, probably best)
- SF Pro
- Neue Montreal

Normal-ish:

- Space Grotesk
- Futura
- ETBookOT (serif, natural)

Weird:

- Optician Sans (headers only since it's all caps)
- Courier New (for code or headers or if I'm feeling experimental)
- Cochin (serif, fancy italics)

### Add a font switcher

In case I go totally insane and can't decide on a font, add a font switcher.
