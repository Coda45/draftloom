# Reconstruction samples

These two synthetic annotated drawings exercise distinct B4 paths:

- `images/warehouse-floorplan.png`: rectangular warehouse, two categories,
  handwritten legend, and an explicit scale cue.
- `images/event-studio-no-scale.png`: L-shaped event studio, two categories,
  and deliberately no scale so the result requires confirmation.

Both raster fixtures were generated for this repository and contain no secret
or user data. The warehouse prompt requested bold walls, blue racks, yellow
tables, a separate legend, and `1 square = 1 m`. The event-studio prompt
requested an L-shaped room, red chairs, a green stage, a separate legend, and
explicitly prohibited scale text.

Open `/samples/fixture-check.html` through Vite to run the deterministic Canvas
preprocessor against both actual images. The normal automated test suite also
uses two synthetic pixel layouts so regressions do not depend on image codecs.
At a 1000-pixel maximum side, the current browser check measures eight wall
candidates and seven color regions in the warehouse image, and six wall
candidates and seven color regions in the event-studio image. Each set of
seven includes the five intended object marks and the two legend swatches.
