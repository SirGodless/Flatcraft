# Sprites

Drop sprite PNGs here, committed to the repo - they ship with every
build (dev server, static hosting, and the dedicated-server/Docker
deployment) with no extra steps. The manifest is generated
automatically.

Path convention (derived from type + id):

    sprites/item/<item_id>.png      e.g. item/golden_shovel.png
    sprites/block/<block_id>.png    e.g. block/stone.png

Rules: PNG, 8 bit per channel, width/height a multiple of 2, at most
128x128. Files that break the rules are skipped with a console warning
and the procedural graphics remain - a missing or broken sprite never
breaks the game.

A sprite here overrides the procedural art for that item/block. Server
mods can additionally provide sprites via DATA_DIR/datapack/sprites/,
which take precedence over the repo versions.
