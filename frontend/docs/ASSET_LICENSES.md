# ECOsonic 3.0 — Asset Licenses & Provenance

All photographic and raster assets bundled in `src/assets/` are downloaded locally and compiled by Vite into static build output. **Zero external image URLs are hotlinked at runtime.**

---

## Selected Asset — ACT 02: FOREST (Large-Leaf Revision)

| Field | Value |
|---|---|
| **Bundled Asset** | `src/assets/forest/coastal-broadleaf-forest.webp` |
| **Derived Depth Map** | `src/assets/forest/coastal-broadleaf-forest-depth.webp` (`512 × 341` grayscale WebP, `1,972` bytes — Gaussian-smoothed 2.5D depth field matching overarching foreground broadleaf branch & understory ferns) |
| **Title / Commons File** | `File:Beech and ferns in Gullmarsskogen.jpg` |
| **Subject** | Damp coastal woodland interior featuring a prominent overarching foreground beech (*Fagus sylvatica*) branch with large, distinct herringbone-veined broadleaves, wet fern understory, and mature dark tree trunks receding into deep forest shade (Gullmarsskogen Nature Reserve) |
| **Creator / Attribution** | `W.carter` (`https://commons.wikimedia.org/wiki/User:W.carter`) |
| **License** | Creative Commons Zero 1.0 Universal (**CC0 1.0**, Public Domain Dedication) |
| **License URL** | `https://creativecommons.org/publicdomain/zero/1.0/` |
| **Original Source Page** | `https://commons.wikimedia.org/wiki/File:Beech_and_ferns_in_Gullmarsskogen.jpg` |
| **Original Media URL** | `https://upload.wikimedia.org/wikipedia/commons/b/bb/Beech_and_ferns_in_Gullmarsskogen.jpg` |
| **Original Resolution & Size** | `5472 × 3648` JPEG (`19,350,949` bytes) |
| **Optimized Resolution & Size** | `coastal-broadleaf-forest.webp`: `2048 × 1365` WebP (`973,830` bytes); `coastal-broadleaf-forest-depth.webp`: `512 × 341` grayscale WebP (`1,972` bytes) |
| **Modifications Made** | Resized cleanly with Lanczos resampling to `2048 × 1365` WebP (`quality=87`); generated companion smoothed 2.5D depth field (`coastal-broadleaf-forest-depth.webp`); graded dynamically in [`src/visual/Forest/forestShaders.ts`](../src/visual/Forest/forestShaders.ts) toward overcast damp coastal forest olive/moss & charcoal-umber tones without losing natural leaf venation. |

### Revision Candidate Evaluation Summary (Large-Leaf Suitability)
Replaced the earlier wide moss-arch photograph (`hoh-old-growth.webp`, retained solely as the untouched reflection map inside ACT 04 water) because thin mossy branches and small distant leaves caused the ACT 03 hero leaf to appear placed in front of empty space rather than detaching from real vegetation. Evaluated 80+ Wikimedia Commons & Openverse photographs across temperate broadleaf/understory searches (`Oplopanax horridus`, `Acer macrophyllum`, `Acer circinatum`, `Alnus glutinosa`, `Fagus sylvatica`): botanical close-ups lacked mature trunks/forest depth, trail-sign images broke documentary realism, and winter beech shots lacked foliage. Selected **`File:Beech and ferns in Gullmarsskogen.jpg`** for its large, clearly separated foreground broadleaves on an overarching woody twig, layered fern/trunk depth, even overcast shade, and natural camouflaged twig junction at UV `(0.608, 0.506)`.

---

## Previous Asset (Retained Only for Untouched ACT 04 Water Reflections)

| Field | Value |
|---|---|
| **Bundled Asset** | `src/assets/forest/hoh-old-growth.webp` (not used by ACT 02 Forest; preserved solely for `waterUniforms.uForestTex` so ACT 04 remains unchanged) |
| **Title / Commons File** | `File:Hall Of Mosses (213654479).jpeg` |
| **Subject** | Temperate coastal old-growth forest — moss-draped bigleaf maples (*Acer macrophyllum*), conifer trunks, and sword fern (*Polystichum munitum*) understory in the Hall of Mosses, Hoh Rain Forest, Olympic National Park, Washington |
| **Creator / Attribution** | Brandon Kuschel (`https://500px.com/bkuschel`) |
| **License** | Creative Commons Attribution 3.0 Unported (**CC BY 3.0**) |
| **License URL** | `https://creativecommons.org/licenses/by/3.0/` |
| **Original Source Page** | `https://commons.wikimedia.org/wiki/File:Hall_Of_Mosses_(213654479).jpeg` |
| **Original Media URL** | `https://upload.wikimedia.org/wikipedia/commons/8/80/Hall_Of_Mosses_%28213654479%29.jpeg` |
| **Original Resolution & Size** | `2048 × 1365` JPEG (`1,753,711` bytes) |
| **Optimized Resolution & Size** | `hoh-old-growth.webp`: `2048 × 1365` WebP (`1,141,580` bytes); `hoh-old-growth-depth.webp`: `512 × 341` grayscale WebP (`1,642` bytes) |
| **Modifications Made** | Converted from JPEG to WebP (`quality=86`); generated companion smoothed grayscale depth map for WebGL 2.5D parallax; rendered through ECOsonic's `16:15` overcast coastal grading, staged emergence, and subtle moisture veil shaders (`src/visual/Forest/forestShaders.ts`). |

---

## Candidate Evaluation Log (10 Sourced Candidates)

Ten real-world public photographs from Wikimedia Commons were downloaded to scratch storage and visually inspected before selection:

1. **`cand_1.jpg`** — `Bigleaf maples and ferns in the Hoh Rain Forest, Olympic National Park (August 2018).jpg` (`4032 × 3024`, CC BY-SA 4.0, Ben1152000). Authentic bigleaf maples and fern floor, rejected due to harsh midday sunlit patches conflicting with subdued overcast documentary atmosphere.
2. **`cand_2.jpg` (SELECTED)** — `Hall Of Mosses (213654479).jpeg` (`2048 × 1365`, CC BY 3.0, Brandon Kuschel). Even overcast canopy light, real monumental moss-draped trunks, sword ferns, background conifer trunks receding into pale mist, subtle late-autumn ochre maple leaves on the right branch/floor, clear foreground–midground–background depth, and zero HDR oversaturation.
3. **`cand_3.jpg`** — `Hall_of_Mosses,_Hoh_Rainforest,_Olympic_National_Park,_Washington_(2015).jpg` (CC BY 4.0). Rejected: centered bright sunlit creek reflection dominates the frame.
4. **`cand_4.jpg`** — `Hoh_Hall_of_Mosses_20060831.jpg` (CC BY-SA 3.0). Rejected: bright direct sunlight on grass and exposed rootball.
5. **`cand_5.jpg`** — `Hoh_Rain_Forest_-_54018550762.jpg` (CC BY 2.0). Rejected: contains park trail signage.
6. **`cand_6.jpg`** — `Olympic_National_Park_-_Hoh_Valley_-_Hall_of_Mosses_Trail_-_Flickr_-_rachel_thecat.jpg` (CC BY-SA 2.0). Rejected: heavy HDR tone-mapping and oversaturated green cast.
7. **`cand_7.jpg`** — `-TravelTuesday_with_My_Public_Lands_(23825649569).jpg` (Public domain). Rejected: mountain ridge sunset rather than coastal old-growth understory.
8. **`cand_8.jpg`** — `-TravelTuesday_with_My_Public_Lands_(24167033776).jpg` (Public domain). Rejected: coastal beach and sea stacks.
9. **`cand_9.jpg`** — `-TravelTuesday_with_My_Public_Lands_(24193693355).jpg` (Public domain). Rejected: coastal wildlife portrait rather than forest interior.
10. **`cand_10.jpg`** — `Foggy_Old_Growth_Forest.jpg` (`4288 × 3216`, CC BY 4.0, Treefender K). Atmospheric foggy conifer silhouettes, rejected because it lacks lower trunks, bark texture, moss, and fern forest floor required for documentary ecological presence and ACT 03 leaf continuity.

---

## Selected Asset — ACT 03: LEAF

| Field | Value |
|---|---|
| **Bundled Albedo + Alpha Matte** | `src/assets/leaf/hero-leaf-albedo.webp` (`896 × 1280` RGBA WebP, `206,098` bytes) |
| **Derived Tangent Normal Map** | `src/assets/leaf/hero-leaf-normal.webp` (`896 × 1280` RGB WebP, `288,166` bytes — derived via Sobel gradient from specimen venation/midrib relief) |
| **Title / Commons File** | `File:2020 year. Herbarium. Alnus glutinosa. img-002.jpg` |
| **Subject** | Isolated botanical herbarium broadleaf scan (*Alnus glutinosa*, alder ~11 cm blade with prominent pale midrib, herringbone lateral veins, and serrated margin) |
| **Creator / Attribution** | Dmitry Makeev (`https://commons.wikimedia.org/wiki/User:Knopik-som`) |
| **License** | Creative Commons Attribution-ShareAlike 4.0 International (**CC BY-SA 4.0**) |
| **License URL** | `https://creativecommons.org/licenses/by-sa/4.0/` |
| **Original Source Page** | `https://commons.wikimedia.org/wiki/File:2020_year._Herbarium._Alnus_glutinosa._img-002.jpg` |
| **Original Resolution & Size** | `2644 × 3870` (native); processed from `1280 × 1874` Commons scan (`680,641` bytes) |
| **Modifications Made** | Cropped paper ruler strip; extracted contiguous alpha matte with 2 px interior color dilation (zero halo); carved ~6 mm jagged V-notch on upper-right margin with oxidized umber rim; color-graded toward wet Pacific Northwest dark olive/umber preserving pale ochre midrib & veins; generated Sobel tangent normal map. |

### Leaf Candidate Evaluation Summary
Evaluated 23 Wikimedia Commons candidates (`Leaf_from_maple_family_found_in_London.jpg` CC0 variegated cultivar rejected; `Multi-color_maple_leaf.jpg` CC BY 4.0 handheld outdoor snapshot rejected; `Herbarium. Betula. img-068.jpg` and `Alnus glutinosa. img-010.jpg` CC BY-SA 4.0 inspected) and selected **`Herbarium. Alnus glutinosa. img-002.jpg`** for its clean ~11 cm broadleaf proportions, raised central pale ochre midrib, herringbone venation, and straight petiole axis ideal for 3D sculptural camber.

---

## Selected Asset — ACT 04: WATER (Shallow Tannin Forest Pool)

| Field | Value |
|---|---|
| **Bundled Asset** | `src/assets/water/forest-pool-bed.webp` |
| **Title / Commons File** | `File:Berdorf (LU), Aesbachtal -- 2015 -- 6356.jpg` |
| **Subject** | Shallow mossy forest pool and damp rocky woodland stream bed at Aesbachtal, Berdorf, Luxembourg |
| **Creator / Attribution** | `Dietmar Rabich` (`https://www.wikidata.org/wiki/Q34788025`) |
| **License** | Creative Commons Attribution-ShareAlike 4.0 International (**CC BY-SA 4.0**) |
| **License URL** | `https://creativecommons.org/licenses/by-sa/4.0/` |
| **Original Source Page** | `https://commons.wikimedia.org/wiki/File:Berdorf_(LU),_Aesbachtal_--_2015_--_6356.jpg` |
| **Original Media URL** | `https://upload.wikimedia.org/wikipedia/commons/6/68/Berdorf_%28LU%29%2C_Aesbachtal_--_2015_--_6356.jpg` |
| **Original Resolution & Size** | `4568 × 3232` JPEG (`9,722,647` bytes) |
| **Optimized Resolution & Size** | `forest-pool-bed.webp`: `1600 × 1132` WebP (`363,442` bytes) |
| **Modifications Made** | Downsampled locally and encoded as static WebP (`1600 × 1132`); sampled beneath tannin water absorption and paired with inverted canopy reflections (`hoh-old-growth.webp`) and deterministic asymmetric wave-normal shading in [`src/visual/Water/waterShaders.ts`](../src/visual/Water/waterShaders.ts). |

---

## Selected Asset — Environmental Bird & Woodland Ambience

| Field | Value |
|---|---|
| **Bundled Asset** | `src/assets/audio/birds_forest.ogg` (copied verbatim from `backend/data/smoke_audio/birds_forest.ogg`) |
| **Title / Commons File** | `File:Birds_forest.ogg` |
| **Subject** | Woodland birdsong field recording (Fontainebleau forest, France; distant woodland ambience and wren calls) |
| **Creator / Attribution** | `barracuda1983` |
| **License** | Public domain, dedicated by the copyright holder |
| **Original Source Page** | `https://commons.wikimedia.org/wiki/File:Birds_forest.ogg` |
| **Format & Duration** | `44100 Hz` Stereo Ogg Vorbis (`187,686` bytes, `14.655s`) |
| **Playback Treatment** | Decoded via shared `AudioContext`, softly distance-filtered, scheduled as staggered cosine-tapered overlapping phrases without loop seam cuts, gated behind user interaction, and equipped with user mute/unmute control in [`src/cinematic/CinematicAudioTimeline.ts`](../src/cinematic/CinematicAudioTimeline.ts). |
