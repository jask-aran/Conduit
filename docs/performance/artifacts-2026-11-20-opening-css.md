# Sheet and paper benchmark, 2026-11-19T19:39Z

Headless Chrome 156.0.8078.79 at 1600x1000, DPR 1, against http://127.0.0.1:4310 (0.8.12-dev.20261119192000.g7a489aa); medians of 5 runs. Headless numbers, not the owner's Windows Chrome; the background off; with the opening-place CSS of 8877a207c injected (`.ui-sheet-fill[data-opening] > :is(.ui-spreadsheet, .ui-document) { position: relative; inset: auto }` and the Empty absolute). Pop-ins count what is visible in the artifact's pane.

## sheet 1x (load average 1.9, 1.5, 1.6, 1.6, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 429 | 1002 | 109 | 593 | 0.0615 | 24 | 176.4 | none |
| warm | 299 | 673 | 109 | 386 | 0.0615 | 23 | 74 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 1 | 8.1 | 1.2 | 2000x2197 |
| arrows across 50 cells | 21 | 14 | 47.5 | Z28 |
| type 20 characters, commit | 1 | 12.7 | 6.6 | bench typing twenty! |
| open the cell menu | 1 | 67.1 | 60.2 | true |
| open a ribbon dropdown | 1 | 10.2 | 3.3 | true |
| select 1,000 cells by drag | 60 | 14.5 | 111.5 | A:W (805), A:V (770), A:Y (875), A:U (735), A:X (840) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 267 resizes div.ui-header-group (16x16 → 124x30)
- 267 appears button.ui-button[Comments] (28x28)
- 267 appears button.ui-button[Comments] > svg (16x16)
- 267 appears button.ui-button[Agents] (16x28)
- 267 appears button.ui-button[Agents] > svg (16x16)
- 267 appears button.ui-button[Open the thread beside] (28x28)
- 267 appears button.ui-button[Open the thread beside] > svg (16x16)
- 266 shifts span.ui-status.ui-size-icon[Opening the sheet] (108px, 16 → 16 high)
- 366 resizes div.ui-header-group (124x30 → 187x30)
- 366 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 367 appears button.ui-button[Open the thread beside] > svg (16x16)
- 367 appears span.ui-setting-value.ui-truncate (42x19)
- 366 shifts div.ui-header-group (63px, 30 → 30 high)
- 528 resizes div.ui-header-group (187x30 → 169x30)
- 528 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 528 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 528 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 528 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 528 resizes div.ui-spreadsheet-body (1256x840 → 1256x798)
- 528 resizes aside.ui-spreadsheet-margin[Comments] (304x840 → 304x798)
- 528 resizes div.ui-spreadsheet-grid (936x840 → 936x798)
- 528 resizes div.ui-spreadsheet-views (936x840 → 936x798)
- 528 resizes div.ui-spreadsheet-rows (936x840 → 936x798)
- 528 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 528 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 528 appears div.ui-spreadsheet-rows > div (936x840)
- 528 appears div.ui-spreadsheet-rows > div (936x840)
- 528 appears div.ui-markup-rails (1020x36)
- 529 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 529 appears span.ui-markup-with (74x36)
- 529 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 529 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 529 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 529 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 529 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 529 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 529 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 529 appears span.ui-title-text.ui-markup-caption (27x15)
- 529 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 529 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 529 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 529 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 529 appears button.ui-icon-button[Underline] (36x36)
- 529 appears button.ui-icon-button[Underline] > svg (14x14)
- 529 appears button.ui-icon-button[Align: Align left] (36x36)
- 529 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 529 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 529 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 529 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 529 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 529 appears button.ui-icon-button[Borders: All borders] (36x36)
- 529 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 529 appears button.ui-icon-button[Merge] (36x36)
- 529 appears button.ui-icon-button[Merge] > svg (14x14)
- 529 appears button.ui-icon-button[Chart] (36x36)
- 529 appears button.ui-icon-button[Chart] > svg (14x14)
- 529 appears button.ui-icon-button[Number format] (36x36)
- 529 appears button.ui-icon-button[Number format] > svg (14x14)
- 529 appears button.ui-icon-button[Vertical align: Align middle] (36x36)
- 529 appears button.ui-icon-button[Vertical align: Align middle] > svg (14x14)
- … 45 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 78 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 78 animation ui-spin span.ui-spinner
- 116 resizes div.ui-header-title (47x18 → 76x18)
- 116 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 116 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 219 resizes div.ui-header-group (16x16 → 124x30)
- 220 appears button.ui-button[Comments] (28x28)
- 220 appears button.ui-button[Comments] > svg (16x16)
- 220 appears button.ui-button[Agents] (16x28)
- 220 appears button.ui-button[Agents] > svg (16x16)
- 220 appears button.ui-button[Open the thread beside] (28x28)
- 220 appears button.ui-button[Open the thread beside] > svg (16x16)
- 218 shifts span.ui-status.ui-size-icon[Opening the sheet] (108px, 16 → 16 high)
- 327 resizes div.ui-header-group (124x30 → 187x30)
- 327 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 328 appears button.ui-button[Open the thread beside] > svg (16x16)
- 328 appears span.ui-setting-value.ui-truncate (42x19)
- 327 shifts div.ui-header-group (63px, 30 → 30 high)
- 400 resizes div.ui-header-group (187x30 → 169x30)
- 400 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 400 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 400 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 400 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 400 resizes div.ui-spreadsheet-body (1256x840 → 1256x798)
- 400 resizes aside.ui-spreadsheet-margin[Comments] (304x840 → 304x798)
- 400 resizes div.ui-spreadsheet-grid (936x840 → 936x798)
- 400 appears div.ui-spreadsheet-views (936x798)
- 400 appears div.ui-spreadsheet-rows (936x798)
- 400 appears div.ui-spreadsheet-rows > div (936x798)
- 400 appears div.ui-spreadsheet-rows > div (936x798)
- 400 appears div.ui-markup-rails (1020x36)
- 400 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 400 appears span.ui-markup-with (74x36)
- 400 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 400 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 400 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 400 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 400 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 400 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 400 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 400 appears span.ui-title-text.ui-markup-caption (27x15)
- 400 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 400 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 400 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 400 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 400 appears button.ui-icon-button[Underline] (36x36)
- 400 appears button.ui-icon-button[Underline] > svg (14x14)
- 400 appears button.ui-icon-button[Align: Align left] (36x36)
- 400 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 400 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 400 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 400 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 400 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 400 appears button.ui-icon-button[Borders: All borders] (36x36)
- 400 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 400 appears button.ui-icon-button[Merge] (36x36)
- 400 appears button.ui-icon-button[Merge] > svg (14x14)
- 400 appears button.ui-icon-button[Chart] (36x36)
- 400 appears button.ui-icon-button[Chart] > svg (14x14)
- 400 appears button.ui-icon-button[Number format] (36x36)
- … 50 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 191–204 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 228–235 /assets/artifact-pane-Dmlo93ut.js 3844
- 230–239 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 230–240 /assets/markup-DQhNIXfG.js 30426
- 231–236 /assets/markup-CDnU5VZp.css 2750
- 232–238 /assets/artifacts-CI_2_mC0.js 1347
- 276–282 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 300–318 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 372–451 /assets/workspace-panel-CTLda2YA.js 8094
- 373–451 /assets/folder-viewer-BnaGrJKm.js 18556
- 373–453 /assets/file-marks-Bfkac6qr.js 82704
- 373–463 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 374–462 /assets/direct-files-D0yQ2M2_.js 2669
- 374–462 /assets/editor-DOyaF3iH.js 605
- 374–461 /assets/folder-viewer-3pEjijTT.css 159
- 374–462 /assets/list-collapse-NQttQipY.js 249
- 374–467 /assets/terminal-pane-Bh6ct0EM.js 12925
- 375–469 /assets/terminal-font-CqS09iKD.js 242
- 375–460 /assets/terminal-pane-C0-Hx5v3.css 420
- 389–471 /assets/artifact-rows-FX4kYm2n.js 1525
- 421–490 /assets/sheet-surface-Buy4kSAi.js 85115
- 422–485 /assets/sheet-display-Cuv0NGIg.js 496
- 422–493 /assets/document-format-cm8fv2KG.js 197575
- 422–505 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 422–505 /assets/grid-2x2-0uAPdsry.js 258
- 422–505 /assets/list-B4oo_eXa.js 246
- 422–505 /assets/sheet-format-DFKRmz4W.js 3422
- 423–518 /assets/whole-word-BwoX5wq3.js 407
- 761–undefined /assets/engine-worker-p_irKaFS.js 272935
- 770–777 /assets/charts-CSFDfsqu.js 5155
- 771–785 /assets/grid-BWVfDuJ9.js 134012
- 771–781 /assets/dist-Cn0wxr_l.js 5293
- 772–780 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 24 ms: 7.2 ms (SimpleWatcher::OnHandleReady 7.2; ParseAuthorStyleSheet 4.7)
- 43 ms: 7 ms (UpdateLayoutTree 5.8)
- 87 ms: 173.3 ms (v8.evaluateModule 165.1; Layout 9.5; UpdateLayoutTree 6.5; UpdateLayoutTree 2.0)
- 324 ms: 10.4 ms (Receive mojo message 10.1)
- 344 ms: 25.9 ms (MinorGC 1.8; V8.GC_SCAVENGER 1.7; V8.GC_SCAVENGER_SCAVENGE 1.7; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 1.1)
- 374 ms: 18.7 ms (FireAnimationFrame 16.3; UpdateLayoutTree 12.8; EventDispatch 1.0)
- 401 ms: 11 ms (UpdateLayoutTree 4.7; Layout 3.0)
- 473 ms: 9.6 ms (v8.evaluateModule 9.4)
- 483 ms: 36.1 ms (Layout 5.4; FunctionCall Ji.a ui-CnGXc9BX.js:2 3.8; UpdateLayoutTree 1.9; FunctionCall ui-CnGXc9BX.js:2 1.1)
- 522 ms: 7.2 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 1.6)
- 547 ms: 64.8 ms (v8.evaluateModule 64.3; MinorGC 2.5; V8.GC_SCAVENGER 2.5; V8.GC_SCAVENGER_SCAVENGE 2.4)
- 612 ms: 52.5 ms (Layout 3.0; MinorGC 2.7; V8.GC_SCAVENGER 2.7; V8.GC_SCAVENGER_SCAVENGE 2.6)
- 707 ms: 49.8 ms (Receive mojo message 49.8; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 42.0; FunctionCall Ji.a ui-CnGXc9BX.js:2 6.7; Layout 3.7)
- 759 ms: 10.7 ms (EventDispatch 4.3; FunctionCall l markup-DQhNIXfG.js:1 4.1; UpdateLayoutTree 4.0; FireAnimationFrame 2.3)
- 771 ms: 40.3 ms (TimerFire 40.3; FunctionCall s nav-gnhBjJsS.js:1 25.1; FunctionCall Ji.a ui-CnGXc9BX.js:2 14.7; UpdateLayoutTree 8.1)
- 829 ms: 21.3 ms (v8.evaluateModule 21.2)
- 852 ms: 10.5 ms ()
- 867 ms: 11.6 ms (SimpleWatcher::OnHandleReady 11.6; FunctionCall O grid-BWVfDuJ9.js:2 11.5)
- 886 ms: 52 ms (FireAnimationFrame 32.6; FunctionCall grid-BWVfDuJ9.js:139 31.2; Layout 10.0; MinorGC 2.2)
- 939 ms: 39.6 ms (FunctionCall O grid-BWVfDuJ9.js:2 39.5)
- 979 ms: 11.2 ms (FireAnimationFrame 1.3; FunctionCall tick 1.3)
- 992 ms: 9.1 ms (FireAnimationFrame 1.2; FunctionCall Ce markup-DQhNIXfG.js:1 1.2; FireAnimationFrame 1.1; FunctionCall charts-CSFDfsqu.js:1 1.1)
- 1070 ms: 10.8 ms (SimpleWatcher::OnHandleReady 10.8; FunctionCall O grid-BWVfDuJ9.js:2 10.7)
## sheet 4x (load average 1.9, 1.8, 1.9, 2, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 1632 | 3970 | 110 | 2412 | 0.0641 | 52 | 721.2 | none |
| warm | 1324 | 2512 | 111 | 1274 | 0.0641 | 45 | 307 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 80 | 43.1 | 251.2 | 2000x2197 |
| arrows across 50 cells | 108 | 58.9 | 1846.5 | Z28 |
| type 20 characters, commit | 37 | 82.3 | 280.4 | bench typing twenty! |
| open the cell menu | 15 | 366.9 | 444.1 | true |
| open a ribbon dropdown | 9 | 57.3 | 82.1 | true |
| select 1,000 cells by drag | 226 | 60.4 | 3562.7 | A1:AM100 (3900) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 362 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 363 animation ui-spin span.ui-spinner
- 367 resizes div.ui-header-title (47x18 → 76x18)
- 367 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 367 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 1197 resizes div.ui-header-group (16x16 → 124x30)
- 1197 appears button.ui-button[Comments] (28x28)
- 1197 appears button.ui-button[Comments] > svg (16x16)
- 1197 appears button.ui-button[Agents] (16x28)
- 1197 appears button.ui-button[Agents] > svg (16x16)
- 1197 appears button.ui-button[Open the thread beside] (28x28)
- 1197 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1196 shifts div.ui-header-group (108px, 16 → 30 high)
- 1314 resizes div.ui-header-group (124x30 → 187x30)
- 1314 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 1315 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1315 appears span.ui-setting-value.ui-truncate (42x19)
- 1313 shifts div.ui-header-group (63px, 30 → 30 high)
- 2151 resizes div.ui-header-group (187x30 → 169x30)
- 2152 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 2152 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 2152 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 2152 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 2152 resizes div.ui-spreadsheet-body (1256x840 → 1256x798)
- 2152 resizes div.ui-spreadsheet-grid (936x840 → 936x798)
- 2152 resizes aside.ui-spreadsheet-margin[Comments] (304x840 → 304x798)
- 2152 resizes div.ui-spreadsheet-views (936x840 → 936x798)
- 2152 resizes div.ui-spreadsheet-rows (936x840 → 936x798)
- 2152 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 2152 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 2152 appears div.ui-spreadsheet-rows > div (936x840)
- 2153 appears div.ui-spreadsheet-rows > div (936x840)
- 2153 appears div.ui-notice (80x18)
- 2153 appears span.ui-spinner (14x14)
- 2153 appears div.ui-markup-rails (1020x36)
- 2153 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 2153 appears span.ui-markup-with (74x36)
- 2153 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 2154 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 2154 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 2154 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 2154 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 2154 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 2154 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 2154 appears span.ui-title-text.ui-markup-caption (27x15)
- 2154 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 2154 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 2154 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 2154 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 2154 appears button.ui-icon-button[Underline] (36x36)
- 2155 appears button.ui-icon-button[Underline] > svg (14x14)
- 2156 appears button.ui-icon-button[Align: Align left] (36x36)
- 2156 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 2156 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 2156 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 2156 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 2156 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 2156 appears button.ui-icon-button[Borders: All borders] (36x36)
- 2156 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 2156 appears button.ui-icon-button[Merge] (36x36)
- … 52 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 179 animation ui-spin span.ui-spinner
- 234 resizes div.ui-header-title (47x18 → 76x18)
- 234 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 234 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 507 resizes div.ui-header-group (16x16 → 124x30)
- 507 appears button.ui-button[Comments] (28x28)
- 507 appears button.ui-button[Comments] > svg (16x16)
- 507 appears button.ui-button[Agents] (16x28)
- 507 appears button.ui-button[Agents] > svg (16x16)
- 508 appears button.ui-button[Open the thread beside] (28x28)
- 508 appears button.ui-button[Open the thread beside] > svg (16x16)
- 507 shifts div.ui-header-group (108px, 16 → 30 high)
- 661 resizes div.ui-header-group (124x30 → 187x30)
- 662 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 663 appears button.ui-button[Open the thread beside] > svg (16x16)
- 663 appears span.ui-setting-value.ui-truncate (42x19)
- 661 shifts div.ui-header-group (63px, 30 → 30 high)
- 1095 resizes div.ui-header-group (187x30 → 169x30)
- 1095 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 1095 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 1095 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 1095 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 1095 resizes div.ui-spreadsheet-body (1256x840 → 1256x798)
- 1095 resizes div.ui-spreadsheet-grid (936x840 → 936x798)
- 1095 resizes aside.ui-spreadsheet-margin[Comments] (304x840 → 304x798)
- 1095 resizes div.ui-spreadsheet-views (936x840 → 936x798)
- 1095 resizes div.ui-spreadsheet-rows (936x840 → 936x798)
- 1095 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 1095 resizes div.ui-spreadsheet-rows > div (936x840 → 936x798)
- 1095 appears div.ui-spreadsheet-rows > div (936x840)
- 1095 appears div.ui-spreadsheet-rows > div (936x840)
- 1095 appears div.ui-markup-rails (1020x36)
- 1095 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 1095 appears span.ui-markup-with (74x36)
- 1095 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 1095 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 1095 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 1095 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 1095 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 1095 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 1095 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 1095 appears span.ui-title-text.ui-markup-caption (27x15)
- 1095 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 1095 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 1095 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 1095 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 1095 appears button.ui-icon-button[Underline] (36x36)
- 1095 appears button.ui-icon-button[Underline] > svg (14x14)
- 1096 appears button.ui-icon-button[Align: Align left] (36x36)
- 1096 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 1096 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 1096 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 1096 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 1096 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 1096 appears button.ui-icon-button[Borders: All borders] (36x36)
- 1096 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 1096 appears button.ui-icon-button[Merge] (36x36)
- 1096 appears button.ui-icon-button[Merge] > svg (14x14)
- 1096 appears button.ui-icon-button[Chart] (36x36)
- 1096 appears button.ui-icon-button[Chart] > svg (14x14)
- … 51 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 599–652 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 758–769 /assets/artifact-pane-Dmlo93ut.js 3844
- 768–772 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 769–774 /assets/markup-DQhNIXfG.js 30426
- 772–778 /assets/markup-CDnU5VZp.css 2750
- 777–780 /assets/artifacts-CI_2_mC0.js 1347
- 912–917 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1120–1123 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1139–1145 /assets/workspace-panel-CTLda2YA.js 8094
- 1143–1150 /assets/folder-viewer-BnaGrJKm.js 18556
- 1144–1157 /assets/file-marks-Bfkac6qr.js 82704
- 1145–1151 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1146–1155 /assets/direct-files-D0yQ2M2_.js 2669
- 1147–1156 /assets/editor-DOyaF3iH.js 605
- 1149–1154 /assets/folder-viewer-3pEjijTT.css 159
- 1150–1161 /assets/list-collapse-NQttQipY.js 249
- 1151–1161 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1152–1161 /assets/terminal-font-CqS09iKD.js 242
- 1153–1160 /assets/terminal-pane-C0-Hx5v3.css 420
- 1188–1194 /assets/artifact-rows-FX4kYm2n.js 1525
- 1925–1940 /assets/sheet-surface-Buy4kSAi.js 85115
- 1926–1933 /assets/sheet-display-Cuv0NGIg.js 496
- 1928–1945 /assets/document-format-cm8fv2KG.js 197575
- 1928–1936 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 1929–1937 /assets/grid-2x2-0uAPdsry.js 258
- 1930–1940 /assets/list-B4oo_eXa.js 246
- 1937–1943 /assets/sheet-format-DFKRmz4W.js 3422
- 1940–1949 /assets/whole-word-BwoX5wq3.js 407
- 3002–undefined /assets/engine-worker-p_irKaFS.js 272935
- 3047–3050 /assets/charts-CSFDfsqu.js 5155
- 3053–3057 /assets/grid-BWVfDuJ9.js 134012
- 3055–3059 /assets/dist-Cn0wxr_l.js 5293
- 3057–3058 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 15 ms: 8.8 ms ()
- 81 ms: 27.8 ms (ParseHTML  27.8; ParseAuthorStyleSheet 13.4)
- 109 ms: 19.1 ms (UpdateLayoutTree 15.6; FireAnimationFrame 1.3)
- 170 ms: 669.1 ms (v8.evaluateModule 624.7; Layout 25.6; UpdateLayoutTree 25.1; UpdateLayoutTree 9.3)
- 847 ms: 25.4 ms (FireAnimationFrame 5.2; FunctionCall m index-DRRjX-nH.js:88 5.2; UpdateLayoutTree 3.7; FunctionCall index-DRRjX-nH.js:57 3.1)
- 922 ms: 11.2 ms (Layout 7.1)
- 959 ms: 39.4 ms (Receive mojo message 39.2)
- 1012 ms: 89.2 ms ()
- 1107 ms: 52.2 ms (FireAnimationFrame 43.6; UpdateLayoutTree 33.1; Layout 3.1; EventDispatch 3.1)
- 1160 ms: 8.1 ms (DocumentLoader::CommitNavigation 1.0)
- 1176 ms: 8.2 ms ()
- 1191 ms: 41.1 ms (FunctionCall e index-DRRjX-nH.js:88 17.9; UpdateLayoutTree 5.7; MinorGC 2.7; V8.GC_SCAVENGER 2.7)
- 1261 ms: 17.9 ms (Layout 5.6; Paint 3.2; Paint 3.1; UpdateLayoutTree 3.1)
- 1305 ms: 9.4 ms ()
- 1328 ms: 19.8 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 14.3)
- 1365 ms: 8.3 ms (UpdateLayoutTree 1.9; FireAnimationFrame 1.5; FunctionCall tick 1.5; Layerize 1.3)
- 1383 ms: 22.5 ms ()
- 1415 ms: 20.5 ms (Layout 10.5; FireAnimationFrame 2.9; FunctionCall tick 2.9; UpdateLayoutTree 1.8)
- 1439 ms: 21.9 ms ()
- 1478 ms: 8.4 ms (Layerize 2.4; UpdateLayoutTree 1.8)
- 1499 ms: 14.8 ms ()
- 1514 ms: 43.2 ms (v8.evaluateModule 41.6)
- 1557 ms: 218.5 ms (Layout 28.7; FunctionCall Ji.a ui-CnGXc9BX.js:2 23.8; UpdateLayoutTree 12.8; UpdateLayoutTree 6.9)
- 1776 ms: 32.3 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 7.0; FunctionCall controls-B4KCFOZ8.js:1 2.7; FunctionCall 2.4; Layerize 2.1)
- 1808 ms: 22.4 ms ()
- 1844 ms: 54.4 ms (TimerFire 54.4; FunctionCall s nav-gnhBjJsS.js:1 52.6; MinorGC 6.2; V8.GC_SCAVENGER 6.1)
- 1909 ms: 102.4 ms (EventDispatch 79.1; FunctionCall after 79.1; UpdateLayoutTree 51.5; Layout 26.6)
- 2045 ms: 25.1 ms (FunctionCall 3.0)
- 2077 ms: 27.4 ms (Layout 9.2; UpdateLayoutTree 7.7; Paint 2.9; Paint 1.6)
- 2113 ms: 250.8 ms (v8.evaluateModule 248.3; MinorGC 5.2; V8.GC_SCAVENGER 5.1; V8.GC_SCAVENGER_SCAVENGE 4.9)
- 2364 ms: 236.1 ms (UpdateLayoutTree 16.0; UpdateLayoutTree 5.6; FunctionCall ui-CnGXc9BX.js:2 5.3; Layout 4.6)
- 2601 ms: 21.6 ms (FireAnimationFrame 3.9; FunctionCall a markup-DQhNIXfG.js:1 3.9; UpdateLayoutTree 3.3; PrePaint 2.3)
- 2648 ms: 13.4 ms (Layerize 2.3; EventDispatch 1.7; FunctionCall after 1.1; UpdateLayoutTree 1.0)
- 2685 ms: 21.6 ms ()
- 2707 ms: 9.2 ms ()
- 2716 ms: 18.6 ms (FireAnimationFrame 7.6; FunctionCall Ce markup-DQhNIXfG.js:1 7.6; UpdateLayoutTree 4.4; Layout 2.3)
- 2753 ms: 201.3 ms (Receive mojo message 201.3; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 191.0; FunctionCall Ji.a ui-CnGXc9BX.js:2 6.9; Layout 5.0)
- 2964 ms: 22.4 ms (FireAnimationFrame 10.7; FunctionCall a markup-DQhNIXfG.js:1 9.9; UpdateLayoutTree 8.9; PrePaint 2.0)
- 2988 ms: 9.4 ms (Receive mojo message 9.4; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 9.3)
- 3043 ms: 8 ms ()
- 3052 ms: 121.2 ms (v8.evaluateModule 120.2; UpdateLayoutTree 2.0)
- 3173 ms: 73.3 ms (Layout 1.2; Layout 1.0; UpdateLayoutTree 1.0)
- 3247 ms: 13 ms (FireAnimationFrame 3.7; FunctionCall a markup-DQhNIXfG.js:1 3.7; Layout 2.5; Layerize 1.7)
- 3266 ms: 77.4 ms (SimpleWatcher::OnHandleReady 77.4; FunctionCall O grid-BWVfDuJ9.js:2 77.3; UpdateLayoutTree 1.4)
- 3345 ms: 13 ms (FireAnimationFrame 4.5; FunctionCall a markup-DQhNIXfG.js:1 4.5; UpdateLayoutTree 3.4; Layerize 1.4)
- 3363 ms: 34.5 ms (FunctionCall O grid-BWVfDuJ9.js:2 33.4; UpdateLayoutTree 3.3; Layout 1.1)
- 3405 ms: 204 ms (FireAnimationFrame 119.3; FunctionCall grid-BWVfDuJ9.js:139 117.5; Layout 37.8; FunctionCall 6.6)
- 3615 ms: 131.1 ms (FunctionCall O grid-BWVfDuJ9.js:2 130.5; MinorGC 4.2; V8.GC_SCAVENGER 4.2; V8.GC_SCAVENGER_SCAVENGE 4.2)
- 3750 ms: 45.7 ms (FireAnimationFrame 5.3; FunctionCall tick 5.2; FireAnimationFrame 3.0; FunctionCall Ce markup-DQhNIXfG.js:1 3.0)
- 3796 ms: 8.6 ms (HandlePostMessage 8.6; FunctionCall B sheet-format-DFKRmz4W.js:3 6.2; FunctionCall Ji.a ui-CnGXc9BX.js:2 2.3)
- 3814 ms: 54 ms (FunctionCall O grid-BWVfDuJ9.js:2 53.8)
- 3870 ms: 32.3 ms (Layerize 1.7)
## paper 1x (load average 1.8, 1.6, 1.7, 1.5, 1.4)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 401 | 988 | 378 | 504 | 0.0027 | 19 | 171.7 | none |
| warm | 295 | 623 | 380 | 272 | 0.0002 | 15 | 83.2 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 7 | 18.8 | 26.8 | true |
| scroll its length | 12 | 14.2 | 23.3 | 17780 of 17780, 17833 of 17833, 17886 of 17886, 17939 of 17939, 17993 of 17993 |
| open the block menu | 2 | 28.1 | 26.6 | true |
| find | 16 | 62.1 | 209.4 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 19 animation ui-spin span.ui-spinner
- 20 resizes div.ui-header-title (47x18 → 88x18)
- 20 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 20 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 327 resizes div.ui-header-group (16x16 → 156x30)
- 327 appears button.ui-button[Comments] (28x28)
- 327 appears button.ui-button[Comments] > svg (16x16)
- 327 appears button.ui-button[Outline] (28x28)
- 327 appears button.ui-button[Outline] > svg (16x16)
- 327 appears button.ui-button[Agents] (16x28)
- 327 appears button.ui-button[Agents] > svg (16x16)
- 327 appears button.ui-button[Open the thread beside] (28x28)
- 327 appears button.ui-button[Open the thread beside] > svg (16x16)
- 327 appears div.ui-markup-room (1256x46)
- 327 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 386 resizes div.ui-header-group (156x30 → 219x30)
- 386 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 386 appears button.ui-button[Open the thread beside] > svg (16x16)
- 386 appears span.ui-setting-value.ui-truncate (42x19)
- 386 shifts div.ui-header-group (63px, 30 → 30 high)
- 608 resizes div.ui-header-group (219x30 → 201x30)
- 608 resizes div.ui-markup-room (1256x46 → 1256x54)
- 608 resizes section.ui-document[bench scratch] (1256x882 → 1256x874)
- 608 resizes div.ui-document-column (1232x862 → 1232x854)
- 608 appears div.ui-markup-rails (1232x46)
- 608 appears div.ui-frost.ui-markup-bar[Mode] (178x32)
- 608 appears div.ui-seg[Mode] (74x26)
- 608 appears span.ui-seg-thumb (36x26)
- 608 appears button[Editing] (24x26)
- 608 appears button[Editing] > svg (16x16)
- 608 appears button[Reviewing] (24x26)
- 608 appears button[Reviewing] > svg (16x16)
- 608 appears span.ui-markup-with (58x28)
- 608 appears button.ui-icon-button[Undo (Ctrl Z)] (28x28)
- 608 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 608 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (28x28)
- 608 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 608 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (28x28)
- 608 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 608 appears div.ui-frost.ui-markup-bar[Document tools] (273x28)
- 608 appears span.ui-title-text.ui-markup-caption (27x15)
- 608 appears button.ui-icon-button[Block: Heading 2] (28x28)
- 608 appears button.ui-icon-button[Block: Heading 2] > svg (14x14)
- 608 appears button.ui-icon-button[Bold (Ctrl B)] (28x28)
- 608 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 608 appears button.ui-icon-button[Italic (Ctrl I)] (28x28)
- 608 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 608 appears button.ui-icon-button[Strikethrough (Ctrl Shift S)] (28x28)
- 608 appears button.ui-icon-button[Strikethrough (Ctrl Shift S)] > svg (14x14)
- 608 appears button.ui-icon-button[Code (Ctrl E)] (28x28)
- 608 appears button.ui-icon-button[Code (Ctrl E)] > svg (14x14)
- 608 appears button.ui-icon-button[Text colour: No colour] (28x28)
- 608 appears button.ui-icon-button[Text colour: No colour] > svg (14x14)
- 608 appears button.ui-icon-button[Highlight: No highlight] (28x28)
- 608 appears button.ui-icon-button[Highlight: No highlight] > svg (14x14)
- 608 appears div.ui-frost.ui-markup-bar[UI markup] (275x28)
- 608 appears span.ui-title-text.ui-markup-caption (47x15)
- 608 appears span.ui-markup-with[Annotate with] (208x28)
- 608 appears button.ui-icon-button[Select text (Q)] (28x28)
- 608 appears button.ui-icon-button[Select text (Q)] > svg (14x14)
- … 13 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 39 animation ui-spin span.ui-spinner
- 39 resizes div.ui-header-title (47x18 → 88x18)
- 39 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 39 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 118 resizes div.ui-header-group (16x16 → 156x30)
- 119 appears button.ui-button[Comments] (28x28)
- 119 appears button.ui-button[Comments] > svg (16x16)
- 119 appears button.ui-button[Outline] (28x28)
- 119 appears button.ui-button[Outline] > svg (16x16)
- 119 appears button.ui-button[Agents] (16x28)
- 119 appears button.ui-button[Agents] > svg (16x16)
- 119 appears button.ui-button[Open the thread beside] (28x28)
- 119 appears button.ui-button[Open the thread beside] > svg (16x16)
- 119 appears div.ui-markup-room (1256x46)
- 118 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 258 resizes div.ui-header-group (156x30 → 201x30)
- 258 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 258 resizes div.ui-markup-room (1256x46 → 1256x54)
- 258 resizes section.ui-document[bench scratch] (1256x882 → 1256x874)
- 258 resizes div.ui-document-column (1232x862 → 1232x854)
- 258 resizes div.ui-document-page (1232x862 → 1232x17919)
- 258 resizes div.ui-document-body (760x714 → 760x17771)
- 258 resizes div.ui-document-content (760x714 → 760x17662)
- 258 appears button.ui-button[Open the thread beside] > svg (16x16)
- 258 appears span.ui-setting-value.ui-truncate (42x19)
- 258 appears header.ui-document-head (760x75)
- 258 appears input.ui-document-title[Name] (760x35)
- 258 appears button.ui-button.ui-document-add (109x28)
- 258 appears button.ui-button.ui-document-add > svg (16x16)
- 258 appears div.ui-answer.ui-document-text[bench scratch] (760x17662)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 258 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- … 320 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 193–208 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 233–240 /assets/artifact-pane-Dmlo93ut.js 3844
- 235–243 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 235–243 /assets/markup-DQhNIXfG.js 30426
- 235–242 /assets/markup-CDnU5VZp.css 2750
- 236–243 /assets/artifacts-CI_2_mC0.js 1347
- 274–279 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 300–315 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 345–402 /assets/workspace-panel-CTLda2YA.js 8094
- 347–490 /assets/folder-viewer-BnaGrJKm.js 18556
- 347–493 /assets/file-marks-Bfkac6qr.js 82704
- 348–490 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 348–496 /assets/direct-files-D0yQ2M2_.js 2669
- 349–500 /assets/editor-DOyaF3iH.js 605
- 350–487 /assets/folder-viewer-3pEjijTT.css 159
- 350–500 /assets/list-collapse-NQttQipY.js 249
- 351–499 /assets/terminal-pane-Bh6ct0EM.js 12925
- 352–503 /assets/terminal-font-CqS09iKD.js 242
- 352–487 /assets/terminal-pane-C0-Hx5v3.css 420
- 367–503 /assets/artifact-rows-FX4kYm2n.js 1525
- 420–529 /assets/paper-surface-AQSmQhNk.js 39580
- 420–531 /assets/document-format-cm8fv2KG.js 197575
- 421–546 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 421–541 /assets/list-B4oo_eXa.js 246
- 421–546 /assets/unlink-B_vKUvuE.js 354
- 421–494 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 32 ms: 11.4 ms (ParseAuthorStyleSheet 9.0)
- 49 ms: 7.5 ms (UpdateLayoutTree 5.9)
- 91 ms: 167.1 ms (v8.evaluateModule 159.3; Layout 9.0; UpdateLayoutTree 5.9; UpdateLayoutTree 2.7)
- 280 ms: 7.3 ms ()
- 304 ms: 7.1 ms ()
- 318 ms: 34.8 ms (MinorGC 1.9; V8.GC_SCAVENGER 1.8; V8.GC_SCAVENGER_SCAVENGE 1.7; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 1.3)
- 353 ms: 16.6 ms (FireAnimationFrame 13.8; UpdateLayoutTree 9.6; EventDispatch 1.9; Layout 1.1)
- 370 ms: 12.8 ms (Receive mojo message 12.4)
- 399 ms: 7.6 ms (EventDispatch 5.1; FunctionCall after 5.1; Layout 3.0; UpdateLayoutTree 1.7)
- 475 ms: 8 ms ()
- 532 ms: 14.1 ms (v8.evaluateModule 13.4; MinorGC 4.5; V8.GC_SCAVENGER 2.2; V8.GC_TIME_TO_SAFEPOINT 2.1)
- 546 ms: 45 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 5.0; Layout 3.9; FunctionCall ui-CnGXc9BX.js:2 3.3; UpdateLayoutTree 2.9)
- 607 ms: 56.3 ms (v8.evaluateModule 55.9)
- 663 ms: 38.1 ms (Layout 2.6)
- 702 ms: 8.5 ms ()
- 727 ms: 14 ms (TimerFire 14.0; FunctionCall s nav-gnhBjJsS.js:1 12.8; MinorGC 2.7; V8.GC_SCAVENGER 2.7)
- 743 ms: 23.5 ms (EventDispatch 19.6; FunctionCall l markup-DQhNIXfG.js:1 19.5; UpdateLayoutTree 9.8; Layout 9.6)
- 776 ms: 159.3 ms (Receive mojo message 159.3; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 154.9; Layout 26.9; MinorGC 3.5)
- 936 ms: 11.5 ms (FunctionCall 5.4; PrePaint 2.9; MinorGC 2.0; V8.GC_SCAVENGER 2.0)
- 955 ms: 44.8 ms (FireAnimationFrame 33.6; FunctionCall Ce markup-DQhNIXfG.js:1 33.3; Layout 19.9; Paint 4.4)
- 1001 ms: 10.3 ms ()
## paper 4x (load average 1.4, 1.8, 1.9, 1.9, 1.8)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 1577 | 3569 | 383 | 2110 | 0.0029 | 37 | 964.1 | none |
| warm | 1253 | 2299 | 382 | 1079 | 0.0029 | 30 | 477.7 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 355 | 93.3 | 4481.1 | true |
| scroll its length | 163 | 91.6 | 1370 | 18046 of 18046, 18099 of 18099, 18152 of 18152, 18178 of 18178, 18231 of 18231 |
| open the block menu | 9 | 180.4 | 289.6 | true |
| find | 31 | 312.8 | 1741.8 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 149 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 216 animation ui-spin span.ui-spinner
- 228 resizes div.ui-header-title (47x18 → 88x18)
- 228 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 228 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 883 resizes div.ui-header-group (16x16 → 156x30)
- 883 appears button.ui-button[Comments] (28x28)
- 883 appears button.ui-button[Comments] > svg (16x16)
- 883 appears button.ui-button[Outline] (28x28)
- 883 appears button.ui-button[Outline] > svg (16x16)
- 883 appears button.ui-button[Agents] (16x28)
- 883 appears button.ui-button[Agents] > svg (16x16)
- 883 appears button.ui-button[Open the thread beside] (28x28)
- 883 appears button.ui-button[Open the thread beside] > svg (16x16)
- 883 appears div.ui-markup-room (1256x46)
- 882 shifts div.ui-header-group (140px, 16 → 30 high)
- 935 resizes div.ui-header-group (156x30 → 219x30)
- 935 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 935 appears button.ui-button[Open the thread beside] > svg (16x16)
- 935 appears span.ui-setting-value.ui-truncate (42x19)
- 1864 resizes div.ui-header-group (219x30 → 201x30)
- 1864 resizes div.ui-markup-room (1256x46 → 1256x54)
- 1864 resizes section.ui-document[bench scratch] (1256x882 → 1256x874)
- 1864 resizes div.ui-document-column (1232x862 → 1232x854)
- 1864 resizes div.ui-document-page (1232x862 → 1232x18158)
- 1864 resizes div.ui-document-body (760x714 → 760x18010)
- 1864 resizes div.ui-document-content (760x714 → 760x17901)
- 1864 appears header.ui-document-head (760x75)
- 1864 appears input.ui-document-title[Name] (760x35)
- 1864 appears button.ui-button.ui-document-add (109x28)
- 1864 appears button.ui-button.ui-document-add > svg (16x16)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1865 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1866 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1866 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1866 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1866 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- … 323 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 135 animation ui-spin span.ui-spinner
- 235 resizes div.ui-header-title (47x18 → 88x18)
- 235 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 235 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 362 resizes div.ui-header-group (16x16 → 156x30)
- 362 appears button.ui-button[Comments] (28x28)
- 362 appears button.ui-button[Comments] > svg (16x16)
- 362 appears button.ui-button[Outline] (28x28)
- 362 appears button.ui-button[Outline] > svg (16x16)
- 362 appears button.ui-button[Agents] (16x28)
- 362 appears button.ui-button[Agents] > svg (16x16)
- 362 appears button.ui-button[Open the thread beside] (28x28)
- 362 appears button.ui-button[Open the thread beside] > svg (16x16)
- 362 appears div.ui-markup-room (1256x46)
- 361 shifts div.ui-header-group (140px, 16 → 30 high)
- 465 resizes div.ui-header-group (156x30 → 219x30)
- 465 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 465 appears button.ui-button[Open the thread beside] > svg (16x16)
- 465 appears span.ui-setting-value.ui-truncate (42x19)
- 1062 resizes div.ui-header-group (219x30 → 201x30)
- 1062 resizes div.ui-markup-room (1256x46 → 1256x54)
- 1062 resizes section.ui-document[bench scratch] (1256x882 → 1256x874)
- 1062 resizes div.ui-document-column (1232x862 → 1232x854)
- 1062 resizes div.ui-document-page (1232x862 → 1232x18158)
- 1062 resizes div.ui-document-body (760x714 → 760x18010)
- 1062 resizes div.ui-document-content (760x714 → 760x17901)
- 1062 appears header.ui-document-head (760x75)
- 1062 appears input.ui-document-title[Name] (760x35)
- 1063 appears button.ui-button.ui-document-add (109x28)
- 1063 appears button.ui-button.ui-document-add > svg (16x16)
- 1063 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
- 1063 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1063 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1063 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1064 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 322 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 546–601 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 728–741 /assets/artifact-pane-Dmlo93ut.js 3844
- 738–742 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 739–744 /assets/markup-DQhNIXfG.js 30426
- 742–749 /assets/markup-CDnU5VZp.css 2750
- 748–751 /assets/artifacts-CI_2_mC0.js 1347
- 894–898 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1069–1073 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1094–1099 /assets/workspace-panel-CTLda2YA.js 8094
- 1097–1102 /assets/folder-viewer-BnaGrJKm.js 18556
- 1098–1107 /assets/file-marks-Bfkac6qr.js 82704
- 1099–1105 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1100–1104 /assets/direct-files-D0yQ2M2_.js 2669
- 1100–1106 /assets/editor-DOyaF3iH.js 605
- 1102–1106 /assets/folder-viewer-3pEjijTT.css 159
- 1103–1110 /assets/list-collapse-NQttQipY.js 249
- 1109–1113 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1110–1114 /assets/terminal-font-CqS09iKD.js 242
- 1111–1115 /assets/terminal-pane-C0-Hx5v3.css 420
- 1140–1146 /assets/artifact-rows-FX4kYm2n.js 1525
- 1969–1979 /assets/paper-surface-AQSmQhNk.js 39580
- 1970–1985 /assets/document-format-cm8fv2KG.js 197575
- 1971–1978 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 1973–1978 /assets/list-B4oo_eXa.js 246
- 1974–1984 /assets/unlink-B_vKUvuE.js 354
- 1975–1981 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 60 ms: 25.5 ms (ParseHTML  25.4; ParseAuthorStyleSheet 14.5)
- 86 ms: 19.9 ms (UpdateLayoutTree 16.1)
- 137 ms: 7.6 ms ()
- 167 ms: 676.7 ms (v8.evaluateModule 641.7; UpdateLayoutTree 30.0; Layout 24.0; UpdateLayoutTree 8.2)
- 849 ms: 22.1 ms (Paint 4.4; FireAnimationFrame 3.4; FunctionCall m index-DRRjX-nH.js:88 3.4; FunctionCall index-DRRjX-nH.js:57 2.7)
- 915 ms: 13 ms (Layout 8.3)
- 949 ms: 29.4 ms (Receive mojo message 28.1)
- 997 ms: 88 ms ()
- 1092 ms: 50.5 ms (FireAnimationFrame 45.0; UpdateLayoutTree 36.6; Layout 2.4; EventDispatch 2.0)
- 1157 ms: 31.9 ms (FunctionCall e index-DRRjX-nH.js:88 10.6; MinorGC 3.2; V8.GC_SCAVENGER 3.1; V8.GC_SCAVENGER_SCAVENGE 3.1)
- 1189 ms: 7.8 ms ()
- 1244 ms: 23.4 ms (Layout 6.2; UpdateLayoutTree 4.7; Paint 4.4; Paint 2.9)
- 1287 ms: 8.6 ms (DocumentLoader::CommitNavigation 1.5; DecodedDataDocumentParser::AppendBytes 1.1)
- 1324 ms: 22.8 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 16.0)
- 1355 ms: 11.9 ms (UpdateLayoutTree 2.3; Layout 1.9; Paint 1.3; Paint 1.2)
- 1370 ms: 9.6 ms (v8.evaluateModule 8.5)
- 1380 ms: 39.7 ms (FunctionCall n ui-CnGXc9BX.js:2 1.6)
- 1433 ms: 28.7 ms (Layout 12.3; FireAnimationFrame 4.7; FunctionCall tick 4.7; UpdateLayoutTree 3.1)
- 1479 ms: 28.3 ms (FunctionCall 1.2)
- 1513 ms: 14.3 ms (Layout 3.1; UpdateLayoutTree 3.1; FireAnimationFrame 2.0; FunctionCall index-DRRjX-nH.js:94 2.0)
- 1539 ms: 38.1 ms (TimerFire 38.1; FunctionCall s nav-gnhBjJsS.js:1 36.9; FunctionCall 1.1)
- 1580 ms: 89.5 ms (EventDispatch 67.3; FunctionCall after 67.2; UpdateLayoutTree 51.0; Layout 13.9)
- 1672 ms: 38.8 ms (v8.evaluateModule 36.8)
- 1711 ms: 142.1 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 16.9; Layout 10.0; UpdateLayoutTree 7.0; FunctionCall ui-CnGXc9BX.js:2 6.9)
- 1855 ms: 27.2 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 9.3; FunctionCall controls-B4KCFOZ8.js:1 4.0; UpdateLayoutTree 2.3; FunctionCall 1.6)
- 1883 ms: 10.3 ms ()
- 1923 ms: 12 ms (UpdateLayoutTree 6.6; FunctionCall 1.1; FireAnimationFrame 1.1)
- 1987 ms: 189.3 ms (v8.evaluateModule 188.3)
- 2176 ms: 130.5 ms (Layout 9.6; UpdateLayoutTree 1.3; FunctionCall 1.1)
- 2308 ms: 11.5 ms (FireAnimationFrame 1.7; FunctionCall e markup-DQhNIXfG.js:1 1.7; Paint 1.2; FireAnimationFrame 1.2)
- 2363 ms: 9 ms (FireAnimationFrame 3.0; FunctionCall a markup-DQhNIXfG.js:1 3.0; Layerize 1.2; Layout 1.1)
- 2386 ms: 871.6 ms (Receive mojo message 871.6; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 854.1; Layout 160.3; Layout 102.2)
- 3262 ms: 92.4 ms (FunctionCall 22.4; Paint 21.1; Paint 20.1; PrePaint 19.8)
