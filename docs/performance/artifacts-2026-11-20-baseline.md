# Sheet and paper benchmark, 2026-11-19T19:57Z

Headless Chrome 156.0.8078.79 at 1600x1000, DPR 1, against http://127.0.0.1:4310 (0.8.12-dev.20261119192000.g7a489aa); medians of 5 runs. Headless numbers, not the owner's Windows Chrome; the background off. Pop-ins count what is visible in the artifact's pane.

## sheet 1x (load average 1.5, 1.9, 1.6, 2, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 523 | 1207 | 113 | 730 | 0.0639 | 29 | 209.3 | none |
| warm | 362 | 855 | 113 | 507 | 0.0615 | 23 | 79.3 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 1 | 10.1 | 3.8 | 2000x2197 |
| arrows across 50 cells | 41 | 16.3 | 113.5 | Z28 |
| type 20 characters, commit | 2 | 17.5 | 16.3 | bench typing twenty! |
| open the cell menu | 2 | 102.5 | 96.6 | true |
| open a ribbon dropdown | 1 | 12 | 5.1 | true |
| select 1,000 cells by drag | 105 | 20 | 372.7 | A:AA (945), A:U (735), A:Y (875), A1:AD100 (3000), A:Z (910) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 23 animation ui-spin span.ui-spinner
- 109 resizes div.ui-header-title (47x18 → 76x18)
- 109 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 109 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 374 resizes div.ui-header-group (16x16 → 124x30)
- 376 appears button.ui-button[Comments] (28x28)
- 376 appears button.ui-button[Comments] > svg (16x16)
- 376 appears button.ui-button[Agents] (16x28)
- 376 appears button.ui-button[Agents] > svg (16x16)
- 376 appears button.ui-button[Open the thread beside] (28x28)
- 376 appears button.ui-button[Open the thread beside] > svg (16x16)
- 373 shifts span.ui-status.ui-size-icon[Opening the sheet] (108px, 16 → 16 high)
- 561 resizes div.ui-header-group (124x30 → 187x30)
- 561 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 561 appears button.ui-button[Open the thread beside] > svg (16x16)
- 561 appears span.ui-setting-value.ui-truncate (42x19)
- 561 shifts div.ui-header-group (63px, 30 → 30 high)
- 745 resizes div.ui-header-group (187x30 → 169x30)
- 745 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 745 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 745 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 745 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 745 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 745 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 745 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 745 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 745 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 745 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 745 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 745 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 745 appears div.ui-spreadsheet-rows > div (936x896)
- 745 appears div.ui-spreadsheet-rows > div (936x896)
- 745 appears div.ui-markup-rails (1020x36)
- 745 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 745 appears span.ui-markup-with (74x36)
- 745 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 745 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 745 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 745 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 745 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 745 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 745 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 745 appears span.ui-title-text.ui-markup-caption (27x15)
- 745 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 745 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 745 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 745 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 745 appears button.ui-icon-button[Underline] (36x36)
- 745 appears button.ui-icon-button[Underline] > svg (14x14)
- 745 appears button.ui-icon-button[Align: Align left] (36x36)
- 745 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 745 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 745 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 745 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 745 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 745 appears button.ui-icon-button[Borders: All borders] (36x36)
- 745 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 745 appears button.ui-icon-button[Merge] (36x36)
- 745 appears button.ui-icon-button[Merge] > svg (14x14)
- 745 appears button.ui-icon-button[Chart] (36x36)
- … 53 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 63 animation ui-spin span.ui-spinner
- 117 resizes div.ui-header-title (47x18 → 76x18)
- 117 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 117 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 204 resizes div.ui-header-group (16x16 → 124x30)
- 204 appears button.ui-button[Comments] (28x28)
- 204 appears button.ui-button[Comments] > svg (16x16)
- 204 appears button.ui-button[Agents] (16x28)
- 204 appears button.ui-button[Agents] > svg (16x16)
- 204 appears button.ui-button[Open the thread beside] (28x28)
- 204 appears button.ui-button[Open the thread beside] > svg (16x16)
- 204 shifts span.ui-status.ui-size-icon[Opening the sheet] (108px, 16 → 16 high)
- 271 resizes div.ui-header-group (124x30 → 187x30)
- 271 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 271 appears button.ui-button[Open the thread beside] > svg (16x16)
- 271 appears span.ui-setting-value.ui-truncate (42x19)
- 271 shifts div.ui-header-group (63px, 30 → 30 high)
- 440 resizes div.ui-header-group (187x30 → 169x30)
- 440 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 440 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 440 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 440 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 440 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 440 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 440 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 440 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 440 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 440 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 440 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 440 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 440 appears div.ui-spreadsheet-rows > div (936x896)
- 440 appears div.ui-spreadsheet-rows > div (936x896)
- 440 appears div.ui-markup-rails (1020x36)
- 440 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 440 appears span.ui-markup-with (74x36)
- 440 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 440 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 440 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 440 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 440 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 440 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 440 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 440 appears span.ui-title-text.ui-markup-caption (27x15)
- 440 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 440 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 440 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 440 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 440 appears button.ui-icon-button[Underline] (36x36)
- 440 appears button.ui-icon-button[Underline] > svg (14x14)
- 440 appears button.ui-icon-button[Align: Align left] (36x36)
- 440 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 440 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 440 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 440 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 440 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 440 appears button.ui-icon-button[Borders: All borders] (36x36)
- 440 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 440 appears button.ui-icon-button[Merge] (36x36)
- 441 appears button.ui-icon-button[Merge] > svg (14x14)
- 441 appears button.ui-icon-button[Chart] (36x36)
- … 53 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 373–390 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 420–428 /assets/artifact-pane-Dmlo93ut.js 3844
- 422–430 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 423–430 /assets/markup-DQhNIXfG.js 30426
- 424–430 /assets/markup-CDnU5VZp.css 2750
- 427–434 /assets/artifacts-CI_2_mC0.js 1347
- 473–478 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 509–517 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 544–559 /assets/workspace-panel-CTLda2YA.js 8094
- 545–559 /assets/folder-viewer-BnaGrJKm.js 18556
- 545–562 /assets/file-marks-Bfkac6qr.js 82704
- 545–559 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 545–559 /assets/direct-files-D0yQ2M2_.js 2669
- 545–559 /assets/editor-DOyaF3iH.js 605
- 546–573 /assets/folder-viewer-3pEjijTT.css 159
- 546–573 /assets/list-collapse-NQttQipY.js 249
- 546–574 /assets/terminal-pane-Bh6ct0EM.js 12925
- 546–573 /assets/terminal-font-CqS09iKD.js 242
- 546–569 /assets/terminal-pane-C0-Hx5v3.css 420
- 568–579 /assets/artifact-rows-FX4kYm2n.js 1525
- 700–747 /assets/sheet-surface-Buy4kSAi.js 85115
- 701–734 /assets/sheet-display-Cuv0NGIg.js 496
- 701–750 /assets/document-format-cm8fv2KG.js 197575
- 701–735 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 701–749 /assets/grid-2x2-0uAPdsry.js 258
- 701–755 /assets/list-B4oo_eXa.js 246
- 702–755 /assets/sheet-format-DFKRmz4W.js 3422
- 705–755 /assets/whole-word-BwoX5wq3.js 407
- 1200–undefined /assets/engine-worker-p_irKaFS.js 272935
- 1216–1222 /assets/charts-CSFDfsqu.js 5155
- 1218–1232 /assets/grid-BWVfDuJ9.js 134012
- 1218–1230 /assets/dist-Cn0wxr_l.js 5293
- 1218–1225 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 20 ms: 16.2 ms ()
- 42 ms: 40.2 ms (ParseAuthorStyleSheet 19.5)
- 84 ms: 14.8 ms (UpdateLayoutTree 13.2)
- 151 ms: 278.9 ms (v8.evaluateModule 269.3; Layout 11.4; UpdateLayoutTree 6.2; MinorGC 5.5)
- 486 ms: 39.1 ms (MinorGC 3.6; V8.GC_SCAVENGER 3.5; V8.GC_SCAVENGER_SCAVENGE 3.5; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 3.2)
- 547 ms: 30.1 ms (FireAnimationFrame 27.5; UpdateLayoutTree 16.4; Layout 8.8)
- 590 ms: 14.8 ms (Receive mojo message 14.5)
- 654 ms: 19.5 ms ()
- 703 ms: 7 ms (Receive mojo message 7.0)
- 714 ms: 17.5 ms (Layout 10.1; UpdateLayoutTree 3.3)
- 732 ms: 18 ms (v8.evaluateModule 16.6; MinorGC 4.4; V8.GC_SCAVENGER 4.4; V8.GC_SCAVENGER_SCAVENGE 4.3)
- 750 ms: 51 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 10.1; UpdateLayoutTree 6.0; Layout 3.0; UpdateLayoutTree 2.2)
- 829 ms: 90.1 ms (v8.evaluateModule 86.1; MinorGC 3.2; V8.GC_SCAVENGER 3.2; V8.GC_SCAVENGER_SCAVENGE 3.1)
- 919 ms: 64.6 ms (Layout 2.8; FunctionCall sheet-surface-Buy4kSAi.js:2 2.1; UpdateLayoutTree 1.9)
- 985 ms: 24.4 ms (FunctionCall controls-B4KCFOZ8.js:1 6.4; PrePaint 6.1; UpdateLayoutTree 2.9; FunctionCall 2.2)
- 1011 ms: 9.1 ms ()
- 1022 ms: 21.4 ms (TimerFire 21.4; FunctionCall s nav-gnhBjJsS.js:1 21.0; MinorGC 3.0; V8.GC_SCAVENGER 2.9)
- 1048 ms: 24.9 ms (FunctionCall b overlay-C9eGFOvy.js:1 24.8; Layout 13.8; UpdateLayoutTree 10.8)
- 1108 ms: 63.3 ms (Receive mojo message 63.2; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 57.7; FunctionCall Ji.a ui-CnGXc9BX.js:2 3.1; Layout 2.8)
- 1175 ms: 10.6 ms (FireAnimationFrame 3.4; FunctionCall a markup-DQhNIXfG.js:1 3.4; UpdateLayoutTree 3.4; FireAnimationFrame 2.5)
- 1199 ms: 17.8 ms ()
- 1230 ms: 30.3 ms (v8.evaluateModule 30.2)
- 1260 ms: 19.8 ms ()
- 1283 ms: 18.6 ms (SimpleWatcher::OnHandleReady 18.6; FunctionCall O grid-BWVfDuJ9.js:2 18.4)
- 1304 ms: 9.2 ms (FunctionCall O grid-BWVfDuJ9.js:2 8.5)
- 1313 ms: 68.8 ms (FireAnimationFrame 35.9; FunctionCall grid-BWVfDuJ9.js:139 35.5; Layout 15.0; MinorGC 2.1)
- 1384 ms: 84.7 ms (FunctionCall O grid-BWVfDuJ9.js:2 84.6; UpdateLayoutTree 1.7)
- 1470 ms: 34.4 ms (FunctionCall overlay-C9eGFOvy.js:1 5.1; Paint 4.7; FireAnimationFrame 1.4; FunctionCall tick 1.4)
- 1505 ms: 31.2 ms (FunctionCall O grid-BWVfDuJ9.js:2 31.2; Layout 2.0)
- 1537 ms: 19.1 ms ()
- 1653 ms: 22.6 ms (SimpleWatcher::OnHandleReady 22.6; FunctionCall O grid-BWVfDuJ9.js:2 22.6)
- 1676 ms: 8.1 ms ()
## sheet 4x (load average 1.9, 1.9, 1.9, 1.9, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 2042 | 5020 | 113 | 3143 | 0.0616 | 64 | 822.9 | none |
| warm | 1622 | 3369 | 115 | 1796 | 0.0641 | 58 | 393.9 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 94 | 52.7 | 551.3 | 2000x2197, 1900x2197 |
| arrows across 50 cells | 109 | 86.2 | 2603.2 | Z28 |
| type 20 characters, commit | 42 | 81.8 | 335.8 | bench typing twenty! |
| open the cell menu | 16 | 462.3 | 575.7 | true |
| open a ribbon dropdown | 10 | 76.7 | 117.7 | true |
| select 1,000 cells by drag | 252 | 74.7 | 4520.3 | A1:AM100 (3900) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 298 animation ui-spin span.ui-spinner
- 580 resizes div.ui-header-title (47x18 → 76x18)
- 581 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 581 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 1390 resizes div.ui-header-group (16x16 → 124x30)
- 1390 appears button.ui-button[Comments] (28x28)
- 1390 appears button.ui-button[Comments] > svg (16x16)
- 1390 appears button.ui-button[Agents] (16x28)
- 1390 appears button.ui-button[Agents] > svg (16x16)
- 1390 appears button.ui-button[Open the thread beside] (28x28)
- 1390 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1389 shifts div.ui-header-group (108px, 16 → 30 high)
- 1565 resizes div.ui-header-group (124x30 → 187x30)
- 1566 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 1566 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1566 appears span.ui-setting-value.ui-truncate (42x19)
- 1564 shifts div.ui-header-group (63px, 30 → 30 high)
- 2694 resizes div.ui-header-group (187x30 → 169x30)
- 2694 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 2694 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 2694 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 2694 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 2694 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 2694 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 2694 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 2695 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 2695 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 2696 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 2696 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 2696 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 2696 appears div.ui-notice (80x18)
- 2696 appears span.ui-spinner (14x14)
- 2696 appears div.ui-spreadsheet-rows > div (936x896)
- 2696 appears div.ui-spreadsheet-rows > div (936x896)
- 2696 appears div.ui-markup-rails (1020x36)
- 2696 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 2696 appears span.ui-markup-with (74x36)
- 2696 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 2696 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 2696 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 2696 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 2696 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 2696 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 2696 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 2696 appears span.ui-title-text.ui-markup-caption (27x15)
- 2696 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 2696 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 2697 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 2697 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 2697 appears button.ui-icon-button[Underline] (36x36)
- 2697 appears button.ui-icon-button[Underline] > svg (14x14)
- 2697 appears button.ui-icon-button[Align: Align left] (36x36)
- 2697 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 2697 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 2697 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 2697 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 2697 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 2697 appears button.ui-icon-button[Borders: All borders] (36x36)
- 2697 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 2697 appears button.ui-icon-button[Merge] (36x36)
- … 55 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 198 animation ui-spin span.ui-spinner
- 247 resizes div.ui-header-title (47x18 → 76x18)
- 247 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 248 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 568 resizes div.ui-header-group (16x16 → 124x30)
- 568 appears button.ui-button[Comments] (28x28)
- 568 appears button.ui-button[Comments] > svg (16x16)
- 568 appears button.ui-button[Agents] (16x28)
- 568 appears button.ui-button[Agents] > svg (16x16)
- 568 appears button.ui-button[Open the thread beside] (28x28)
- 568 appears button.ui-button[Open the thread beside] > svg (16x16)
- 567 shifts div.ui-header-group (108px, 16 → 30 high)
- 742 resizes div.ui-header-group (124x30 → 187x30)
- 742 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 746 appears button.ui-button[Open the thread beside] > svg (16x16)
- 746 appears span.ui-setting-value.ui-truncate (42x19)
- 741 shifts div.ui-header-group (63px, 30 → 30 high)
- 1429 resizes div.ui-header-group (187x30 → 169x30)
- 1430 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 1430 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 1430 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 1430 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 1430 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 1430 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 1430 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 1431 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 1431 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 1431 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 1431 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1431 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1431 appears div.ui-spreadsheet-rows > div (936x896)
- 1431 appears div.ui-spreadsheet-rows > div (936x896)
- 1432 appears div.ui-markup-rails (1020x36)
- 1432 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 1432 appears span.ui-markup-with (74x36)
- 1432 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 1433 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 1433 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 1433 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 1433 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 1433 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 1433 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 1433 appears span.ui-title-text.ui-markup-caption (27x15)
- 1433 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 1433 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 1433 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 1433 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 1433 appears button.ui-icon-button[Underline] (36x36)
- 1433 appears button.ui-icon-button[Underline] > svg (14x14)
- 1433 appears button.ui-icon-button[Align: Align left] (36x36)
- 1433 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 1433 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 1434 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 1434 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 1434 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 1434 appears button.ui-icon-button[Borders: All borders] (36x36)
- 1434 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 1434 appears button.ui-icon-button[Merge] (36x36)
- 1434 appears button.ui-icon-button[Merge] > svg (14x14)
- 1435 appears button.ui-icon-button[Chart] (36x36)
- … 55 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 877–947 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 1102–1116 /assets/artifact-pane-Dmlo93ut.js 3844
- 1120–1125 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 1121–1126 /assets/markup-DQhNIXfG.js 30426
- 1124–1131 /assets/markup-CDnU5VZp.css 2750
- 1130–1135 /assets/artifacts-CI_2_mC0.js 1347
- 1299–1303 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1518–1522 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1560–1566 /assets/workspace-panel-CTLda2YA.js 8094
- 1563–1569 /assets/folder-viewer-BnaGrJKm.js 18556
- 1567–1587 /assets/file-marks-Bfkac6qr.js 82704
- 1569–1589 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1576–1587 /assets/direct-files-D0yQ2M2_.js 2669
- 1576–1590 /assets/editor-DOyaF3iH.js 605
- 1576–1590 /assets/folder-viewer-3pEjijTT.css 159
- 1577–1591 /assets/list-collapse-NQttQipY.js 249
- 1577–1598 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1577–1598 /assets/terminal-font-CqS09iKD.js 242
- 1577–1597 /assets/terminal-pane-C0-Hx5v3.css 420
- 1624–1633 /assets/artifact-rows-FX4kYm2n.js 1525
- 2714–2722 /assets/sheet-surface-Buy4kSAi.js 85115
- 2718–2723 /assets/sheet-display-Cuv0NGIg.js 496
- 2721–2740 /assets/document-format-cm8fv2KG.js 197575
- 2726–2738 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 2727–2749 /assets/grid-2x2-0uAPdsry.js 258
- 2729–2749 /assets/list-B4oo_eXa.js 246
- 2730–2749 /assets/sheet-format-DFKRmz4W.js 3422
- 2730–2749 /assets/whole-word-BwoX5wq3.js 407
- 3831–undefined /assets/engine-worker-p_irKaFS.js 272935
- 3891–3896 /assets/charts-CSFDfsqu.js 5155
- 3896–3902 /assets/grid-BWVfDuJ9.js 134012
- 3898–3902 /assets/dist-Cn0wxr_l.js 5293
- 3903–3906 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 11 ms: 8.2 ms ()
- 40 ms: 13.8 ms ()
- 56 ms: 38.4 ms (ParseHTML  38.4; ParseAuthorStyleSheet 23.9)
- 96 ms: 35.7 ms (UpdateLayoutTree 26.6; PrePaint 3.3; Paint 1.7)
- 142 ms: 8.2 ms ()
- 152 ms: 7.1 ms ()
- 231 ms: 975 ms (v8.evaluateModule 936.0; UpdateLayoutTree 30.5; Layout 28.0; UpdateLayoutTree 9.6)
- 1215 ms: 26.1 ms (FunctionCall index-DRRjX-nH.js:57 5.7; FireAnimationFrame 4.3; FunctionCall m index-DRRjX-nH.js:88 4.3; UpdateLayoutTree 3.1)
- 1289 ms: 14.6 ms (Layout 10.9)
- 1330 ms: 49.1 ms (Receive mojo message 47.8)
- 1394 ms: 13.6 ms ()
- 1408 ms: 121.2 ms (MinorGC 4.2; V8.GC_SCAVENGER 3.9; V8.GC_SCAVENGER_SCAVENGE 3.9; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 2.2)
- 1542 ms: 77.7 ms (FireAnimationFrame 69.1; UpdateLayoutTree 54.5; EventDispatch 5.2; Layout 3.4)
- 1619 ms: 9.3 ms (DocumentLoader::CommitNavigation 1.2)
- 1630 ms: 8.8 ms (DocumentLoader::CommitNavigation 2.7; DocumentLoader::DidInstallNewDocument 1.2)
- 1640 ms: 50.1 ms (FunctionCall e index-DRRjX-nH.js:88 22.8; UpdateLayoutTree 12.7; Layout 1.1)
- 1691 ms: 9.4 ms (URLLoader::loadAsynchronously 1.4; URLLoader::Context::Start 1.4)
- 1722 ms: 39.1 ms (Layout 12.7; Layerize 5.5; UpdateLayoutTree 5.0; PrePaint 1.6)
- 1762 ms: 16.8 ms (Receive mojo message 16.8)
- 1804 ms: 15.8 ms (DocumentLoader::DocumentLoader 3.4; DocumentLoader::CommitNavigation 3.0; DecodedDataDocumentParser::AppendBytes 1.2; PrePaint 1.1)
- 1857 ms: 31.3 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 22.8; FunctionCall Gu index-DRRjX-nH.js:36 1.5)
- 1893 ms: 8.6 ms (v8.evaluateModule 5.6)
- 1901 ms: 57.9 ms (FunctionCall Gu index-DRRjX-nH.js:36 1.0)
- 1960 ms: 58.4 ms (Layout 21.5; FireAnimationFrame 13.1; FunctionCall tick 13.1; Paint 9.7)
- 2025 ms: 14.1 ms ()
- 2044 ms: 13.7 ms ()
- 2066 ms: 11.1 ms (Receive mojo message 11.0; FunctionCall r.cn workbox-window.prod.es5-Bd17z0YL.js:2 11.0)
- 2077 ms: 50.2 ms (TimerFire 50.2; FunctionCall s nav-gnhBjJsS.js:1 44.9; FunctionCall 3.6)
- 2128 ms: 70 ms (UpdateLayoutTree 59.3; FunctionCall s.<computed>.onfinish nav-gnhBjJsS.js:1 4.0; EventDispatch 1.5; FunctionCall t overlay-C9eGFOvy.js:1 1.5)
- 2198 ms: 37.9 ms ()
- 2261 ms: 18 ms (v8.evaluateModule 17.8)
- 2279 ms: 252.9 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 34.1; UpdateLayoutTree 20.3; Layout 14.7; Layout 13.7)
- 2534 ms: 45.7 ms (FunctionCall controls-B4KCFOZ8.js:1 9.9; FunctionCall folder-viewer-BnaGrJKm.js:2 7.3; UpdateLayoutTree 6.3; UpdateLayoutTree 5.8)
- 2582 ms: 18.2 ms ()
- 2622 ms: 10.5 ms (UpdateLayoutTree 3.2; FunctionCall 2.0)
- 2681 ms: 7.2 ms ()
- 2721 ms: 334.7 ms (v8.evaluateModule 332.3; MinorGC 11.0; V8.GC_SCAVENGER 10.2; V8.GC_SCAVENGER_SCAVENGE 10.1)
- 3056 ms: 279.2 ms (Layout 18.6; UpdateLayoutTree 9.2; FunctionCall ui-CnGXc9BX.js:2 5.2; UpdateLayoutTree 5.1)
- 3338 ms: 24.4 ms (FireAnimationFrame 5.4; FunctionCall a markup-DQhNIXfG.js:1 5.4; UpdateLayoutTree 4.1; FireAnimationFrame 2.4)
- 3396 ms: 17 ms (EventDispatch 2.6; FunctionCall after 2.3; Layerize 1.6; UpdateLayoutTree 1.3)
- 3447 ms: 40.9 ms ()
- 3488 ms: 9.3 ms ()
- 3497 ms: 36 ms (FireAnimationFrame 14.3; FunctionCall Ce markup-DQhNIXfG.js:1 14.3; UpdateLayoutTree 9.2; Layout 4.9)
- 3552 ms: 234.7 ms (Receive mojo message 234.6; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 221.3; FunctionCall Ji.a ui-CnGXc9BX.js:2 7.6; Layout 6.7)
- 3795 ms: 27.9 ms (FireAnimationFrame 9.2; FunctionCall a markup-DQhNIXfG.js:1 9.2; UpdateLayoutTree 9.1; Layerize 5.0)
- 3826 ms: 10.2 ms (Receive mojo message 10.2; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 9.5)
- 3883 ms: 10.2 ms ()
- 3893 ms: 178 ms (v8.evaluateModule 176.6; MinorGC 7.3; V8.GC_SCAVENGER 7.3; V8.GC_SCAVENGER_SCAVENGE 7.2)
- 4071 ms: 92.8 ms (UpdateLayoutTree 6.5; UpdateLayoutTree 5.8; UpdateLayoutTree 3.3; UpdateLayoutTree 3.1)
- 4165 ms: 19.2 ms (FireAnimationFrame 10.9; FunctionCall Ce markup-DQhNIXfG.js:1 10.9; FireAnimationFrame 3.1; FunctionCall a markup-DQhNIXfG.js:1 3.1)
- 4195 ms: 115.2 ms (SimpleWatcher::OnHandleReady 115.1; FunctionCall O grid-BWVfDuJ9.js:2 115.0; UpdateLayoutTree 2.4)
- 4311 ms: 11.5 ms (FireAnimationFrame 6.2; FunctionCall a markup-DQhNIXfG.js:1 6.1; UpdateLayoutTree 4.2; Layerize 1.4)
- 4323 ms: 7.8 ms (TimerFire 7.8; FunctionCall Ji.a ui-CnGXc9BX.js:2 5.0; FunctionCall sheet-surface-Buy4kSAi.js:2 2.8; UpdateLayoutTree 2.1)
- 4332 ms: 7.1 ms (HandlePostMessage 7.1; FunctionCall B sheet-format-DFKRmz4W.js:3 6.4)
- 4341 ms: 45 ms (FunctionCall O grid-BWVfDuJ9.js:2 40.4; UpdateLayoutTree 4.9; FunctionCall 3.2)
- 4387 ms: 315.1 ms (FireAnimationFrame 198.6; FunctionCall grid-BWVfDuJ9.js:139 197.2; Layout 61.1; FunctionCall We markup-DQhNIXfG.js:1 6.3)
- 4703 ms: 7.5 ms (TimerFire 7.4; FunctionCall grid-BWVfDuJ9.js:127 7.4)
- 4711 ms: 186.9 ms (FunctionCall O grid-BWVfDuJ9.js:2 186.8; Layout 2.6; UpdateLayoutTree 1.2)
- 4902 ms: 56.4 ms (FireAnimationFrame 6.2; FunctionCall tick 6.2; FireAnimationFrame 3.4; FunctionCall Ce markup-DQhNIXfG.js:1 3.4)
- 4958 ms: 22.3 ms (HandlePostMessage 22.3; FunctionCall B sheet-format-DFKRmz4W.js:3 20.2; MinorGC 5.3; V8.GC_SCAVENGER 5.2)
- 4999 ms: 100.7 ms (FunctionCall O grid-BWVfDuJ9.js:2 100.7; Layout 1.4)
- 5102 ms: 35.6 ms (Layerize 2.7; FireAnimationFrame 1.7; FunctionCall Ce markup-DQhNIXfG.js:1 1.7; Paint 1.6)
- 7519 ms: 7.5 ms (FireAnimationFrame 4.7)
- 7534 ms: 8.6 ms ()
## paper 1x (load average 1.9, 1.9, 1.8, 1.9, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 415 | 984 | 381 | 555 | 0.0002 | 16 | 194 | none |
| warm | 328 | 675 | 381 | 287 | 0.0002 | 16 | 96 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 8 | 20.4 | 34.1 | true |
| scroll its length | 16 | 13 | 46.9 | 17780 of 17780, 17833 of 17833, 17886 of 17886, 17939 of 17939, 17993 of 17993 |
| open the block menu | 2 | 32.1 | 37.8 | true |
| find | 20 | 59.7 | 198.5 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 216 resizes div.ui-header-group (16x16 → 156x30)
- 216 resizes div.ui-empty (1224x896 → 1224x850)
- 216 appears button.ui-button[Comments] (28x28)
- 216 appears button.ui-button[Comments] > svg (16x16)
- 216 appears button.ui-button[Outline] (28x28)
- 216 appears button.ui-button[Outline] > svg (16x16)
- 216 appears button.ui-button[Agents] (16x28)
- 216 appears button.ui-button[Agents] > svg (16x16)
- 216 appears button.ui-button[Open the thread beside] (28x28)
- 216 appears button.ui-button[Open the thread beside] > svg (16x16)
- 216 appears div.ui-markup-room (1256x46)
- 216 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 237 resizes div.ui-header-group (156x30 → 219x30)
- 237 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 237 appears button.ui-button[Open the thread beside] > svg (16x16)
- 237 appears span.ui-setting-value.ui-truncate (42x19)
- 236 shifts div.ui-header-group (63px, 30 → 30 high)
- 480 resizes div.ui-header-group (219x30 → 201x30)
- 480 resizes div.ui-markup-room (1256x46 → 1256x54)
- 480 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 480 resizes div.ui-document-column (1232x964 → 1232x854)
- 480 resizes div.ui-document-page (1232x964 → 1232x17919)
- 480 resizes div.ui-document-body (760x816 → 760x17771)
- 480 resizes div.ui-document-content (760x816 → 760x17662)
- 480 appears header.ui-document-head (760x75)
- 480 appears input.ui-document-title[Name] (760x35)
- 480 appears button.ui-button.ui-document-add (109x28)
- 480 appears button.ui-button.ui-document-add > svg (16x16)
- 481 appears div.ui-answer.ui-document-text[bench scratch] (760x17662)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 481 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 482 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- … 319 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 34 animation ui-spin span.ui-spinner
- 37 resizes div.ui-header-title (47x18 → 88x18)
- 37 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 37 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 129 resizes div.ui-header-group (16x16 → 156x30)
- 129 resizes div.ui-empty (1224x896 → 1224x850)
- 130 appears button.ui-button[Comments] (28x28)
- 130 appears button.ui-button[Comments] > svg (16x16)
- 130 appears button.ui-button[Outline] (28x28)
- 130 appears button.ui-button[Outline] > svg (16x16)
- 130 appears button.ui-button[Agents] (16x28)
- 130 appears button.ui-button[Agents] > svg (16x16)
- 130 appears button.ui-button[Open the thread beside] (28x28)
- 130 appears button.ui-button[Open the thread beside] > svg (16x16)
- 130 appears div.ui-markup-room (1256x46)
- 129 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 256 resizes div.ui-header-group (156x30 → 201x30)
- 256 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 256 resizes div.ui-markup-room (1256x46 → 1256x54)
- 256 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 256 resizes div.ui-document-column (1232x964 → 1232x854)
- 256 resizes div.ui-document-page (1232x964 → 1232x17919)
- 256 resizes div.ui-document-body (760x816 → 760x17771)
- 256 resizes div.ui-document-content (760x816 → 760x17662)
- 256 appears button.ui-button[Open the thread beside] > svg (16x16)
- 256 appears span.ui-setting-value.ui-truncate (42x19)
- 256 appears header.ui-document-head (760x75)
- 256 appears input.ui-document-title[Name] (760x35)
- 256 appears button.ui-button.ui-document-add (109x28)
- 256 appears button.ui-button.ui-document-add > svg (16x16)
- 256 appears div.ui-answer.ui-document-text[bench scratch] (760x17662)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 256 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 321 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 201–215 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 241–248 /assets/artifact-pane-Dmlo93ut.js 3844
- 243–251 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 243–251 /assets/markup-DQhNIXfG.js 30426
- 244–249 /assets/markup-CDnU5VZp.css 2750
- 246–251 /assets/artifacts-CI_2_mC0.js 1347
- 281–286 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 303–330 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 371–427 /assets/workspace-panel-CTLda2YA.js 8094
- 371–429 /assets/folder-viewer-BnaGrJKm.js 18556
- 372–443 /assets/file-marks-Bfkac6qr.js 82704
- 372–438 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 372–437 /assets/direct-files-D0yQ2M2_.js 2669
- 372–438 /assets/editor-DOyaF3iH.js 605
- 372–429 /assets/folder-viewer-3pEjijTT.css 159
- 373–438 /assets/list-collapse-NQttQipY.js 249
- 373–447 /assets/terminal-pane-Bh6ct0EM.js 12925
- 373–450 /assets/terminal-font-CqS09iKD.js 242
- 373–430 /assets/terminal-pane-C0-Hx5v3.css 420
- 383–447 /assets/artifact-rows-FX4kYm2n.js 1525
- 390–456 /assets/paper-surface-AQSmQhNk.js 39580
- 390–463 /assets/document-format-cm8fv2KG.js 197575
- 390–458 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 390–459 /assets/list-B4oo_eXa.js 246
- 390–459 /assets/unlink-B_vKUvuE.js 354
- 391–433 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 35 ms: 12.1 ms (ParseAuthorStyleSheet 10.0)
- 51 ms: 15.4 ms (UpdateLayoutTree 14.5)
- 100 ms: 161.7 ms (v8.evaluateModule 154.9; Layout 8.5; UpdateLayoutTree 4.5; UpdateLayoutTree 1.8)
- 318 ms: 12.5 ms (Receive mojo message 12.5)
- 339 ms: 21.8 ms (MinorGC 1.4; V8.GC_SCAVENGER 1.4; V8.GC_SCAVENGER_SCAVENGE 1.4; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 1.1)
- 365 ms: 15.9 ms (FireAnimationFrame 14.0; UpdateLayoutTree 9.1; Layout 3.0)
- 433 ms: 10 ms (v8.evaluateModule 9.8)
- 443 ms: 40.9 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 7.5; UpdateLayoutTree 5.1; Layout 2.8; FunctionCall ui-CnGXc9BX.js:2 1.4)
- 493 ms: 8.5 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 3.0)
- 512 ms: 49.3 ms (v8.evaluateModule 48.6; MinorGC 2.4; V8.GC_SCAVENGER 2.3; V8.GC_SCAVENGER_SCAVENGE 2.3)
- 562 ms: 35.2 ms (Layout 2.3)
- 647 ms: 162.8 ms (Receive mojo message 162.8; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 158.0; Layout 37.3; Layout 3.2)
- 812 ms: 68.6 ms (FireAnimationFrame 44.8; FunctionCall Ce markup-DQhNIXfG.js:1 44.4; Layout 30.1; FunctionCall 8.6)
- 888 ms: 19.1 ms (TimerFire 19.1; FunctionCall s nav-gnhBjJsS.js:1 18.4)
- 907 ms: 46.1 ms (Layout 34.9; UpdateLayoutTree 10.8)
## paper 4x (load average 1.9, 2, 2, 2, 1.6)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 2047 | 4526 | 383 | 2694 | 0.0005 | 48 | 1277.8 | none |
| warm | 1777 | 3140 | 383 | 1413 | 0.0029 | 44 | 679.6 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 337 | 101.9 | 4952.9 | true |
| scroll its length | 174 | 131.4 | 1749.6 | 18046 of 18046, 18099 of 18099, 18152 of 18152, 18178 of 18178, 18231 of 18231 |
| open the block menu | 12 | 190.6 | 323.5 | true |
| find | 33 | 366.4 | 1983.8 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 178 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 258 animation ui-spin span.ui-spinner
- 269 resizes div.ui-header-title (47x18 → 88x18)
- 269 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 269 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 1184 resizes div.ui-header-group (16x16 → 156x30)
- 1184 resizes div.ui-empty (1224x896 → 1224x850)
- 1184 appears button.ui-button[Comments] (28x28)
- 1184 appears button.ui-button[Comments] > svg (16x16)
- 1184 appears button.ui-button[Outline] (28x28)
- 1184 appears button.ui-button[Outline] > svg (16x16)
- 1184 appears button.ui-button[Agents] (16x28)
- 1185 appears button.ui-button[Agents] > svg (16x16)
- 1185 appears button.ui-button[Open the thread beside] (28x28)
- 1185 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1185 appears div.ui-markup-room (1256x46)
- 1184 shifts div.ui-header-group (140px, 16 → 30 high)
- 1254 resizes div.ui-header-group (156x30 → 219x30)
- 1254 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 1254 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1255 appears span.ui-setting-value.ui-truncate (42x19)
- 2683 resizes div.ui-header-group (219x30 → 201x30)
- 2685 resizes div.ui-markup-room (1256x46 → 1256x54)
- 2685 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 2685 resizes div.ui-document-column (1232x964 → 1232x854)
- 2685 resizes div.ui-document-page (1232x964 → 1232x18158)
- 2685 resizes div.ui-document-body (760x816 → 760x18010)
- 2685 resizes div.ui-document-content (760x816 → 760x17901)
- 2685 appears header.ui-document-head (760x75)
- 2685 appears input.ui-document-title[Name] (760x35)
- 2685 appears button.ui-button.ui-document-add (109x28)
- 2685 appears button.ui-button.ui-document-add > svg (16x16)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2685 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 324 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 231 animation ui-spin span.ui-spinner
- 311 resizes div.ui-header-title (47x18 → 88x18)
- 311 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 311 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 457 resizes div.ui-header-group (16x16 → 156x30)
- 457 resizes div.ui-empty (1224x896 → 1224x850)
- 457 appears button.ui-button[Comments] (28x28)
- 457 appears button.ui-button[Comments] > svg (16x16)
- 457 appears button.ui-button[Outline] (28x28)
- 457 appears button.ui-button[Outline] > svg (16x16)
- 457 appears button.ui-button[Agents] (16x28)
- 457 appears button.ui-button[Agents] > svg (16x16)
- 457 appears button.ui-button[Open the thread beside] (28x28)
- 457 appears button.ui-button[Open the thread beside] > svg (16x16)
- 457 appears div.ui-markup-room (1256x46)
- 457 shifts div.ui-header-group (140px, 16 → 30 high)
- 571 resizes div.ui-header-group (156x30 → 219x30)
- 571 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 571 appears button.ui-button[Open the thread beside] > svg (16x16)
- 571 appears span.ui-setting-value.ui-truncate (42x19)
- 1135 resizes div.ui-header-group (219x30 → 201x30)
- 1135 resizes div.ui-markup-room (1256x46 → 1256x54)
- 1135 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 1135 resizes div.ui-document-column (1232x964 → 1232x854)
- 1135 resizes div.ui-document-page (1232x964 → 1232x18158)
- 1135 resizes div.ui-document-body (760x816 → 760x18010)
- 1135 resizes div.ui-document-content (760x816 → 760x17901)
- 1136 appears header.ui-document-head (760x75)
- 1136 appears input.ui-document-title[Name] (760x35)
- 1136 appears button.ui-button.ui-document-add (109x28)
- 1136 appears button.ui-button.ui-document-add > svg (16x16)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1136 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 1137 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- … 323 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 698–749 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 873–885 /assets/artifact-pane-Dmlo93ut.js 3844
- 883–887 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 884–890 /assets/markup-DQhNIXfG.js 30426
- 888–895 /assets/markup-CDnU5VZp.css 2750
- 894–897 /assets/artifacts-CI_2_mC0.js 1347
- 1049–1053 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1237–1240 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1259–1266 /assets/workspace-panel-CTLda2YA.js 8094
- 1263–1267 /assets/folder-viewer-BnaGrJKm.js 18556
- 1264–1275 /assets/file-marks-Bfkac6qr.js 82704
- 1265–1270 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1266–1271 /assets/direct-files-D0yQ2M2_.js 2669
- 1267–1273 /assets/editor-DOyaF3iH.js 605
- 1269–1273 /assets/folder-viewer-3pEjijTT.css 159
- 1271–1278 /assets/list-collapse-NQttQipY.js 249
- 1272–1278 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1273–1278 /assets/terminal-font-CqS09iKD.js 242
- 1275–1280 /assets/terminal-pane-C0-Hx5v3.css 420
- 1321–1333 /assets/artifact-rows-FX4kYm2n.js 1525
- 2352–2376 /assets/paper-surface-AQSmQhNk.js 39580
- 2352–2385 /assets/document-format-cm8fv2KG.js 197575
- 2353–2372 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 2353–2375 /assets/list-B4oo_eXa.js 246
- 2353–2375 /assets/unlink-B_vKUvuE.js 354
- 2357–2380 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 10 ms: 7.3 ms ()
- 106 ms: 32.6 ms (ParseHTML  32.6; ParseAuthorStyleSheet 17.0)
- 139 ms: 28.9 ms (UpdateLayoutTree 24.7)
- 184 ms: 7.1 ms ()
- 221 ms: 744.4 ms (v8.evaluateModule 710.6; Layout 27.7; UpdateLayoutTree 27.4; UpdateLayoutTree 7.1)
- 973 ms: 18.4 ms (FireAnimationFrame 3.2; FunctionCall m index-DRRjX-nH.js:88 3.2; Paint 3.1; FunctionCall index-DRRjX-nH.js:57 2.6)
- 1040 ms: 13 ms (Layout 9.3; EventDispatch 1.2)
- 1075 ms: 37.6 ms (Receive mojo message 37.6)
- 1126 ms: 122.9 ms ()
- 1257 ms: 72.2 ms (FireAnimationFrame 65.0; UpdateLayoutTree 51.8; Layout 5.0; EventDispatch 3.4)
- 1330 ms: 14.5 ms (DocumentLoader::CommitNavigation 2.5; DocumentLoader::StartLoadingResponse 1.5; DocumentLoader::FinishedLoading 1.3; DecodedDataDocumentParser::AppendBytes 1.0)
- 1346 ms: 8.4 ms ()
- 1355 ms: 14.4 ms ()
- 1370 ms: 42.5 ms (FunctionCall e index-DRRjX-nH.js:88 17.1; UpdateLayoutTree 5.5; MinorGC 3.9; V8.GC_SCAVENGER 3.9)
- 1412 ms: 7.8 ms ()
- 1426 ms: 7.4 ms ()
- 1434 ms: 28.4 ms (Paint 7.5; Layout 7.1; UpdateLayoutTree 5.7; Paint 4.3)
- 1540 ms: 10.5 ms (DocumentLoader::CommitNavigation 1.2)
- 1567 ms: 21.6 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 17.3)
- 1604 ms: 30.4 ms (FunctionCall n ui-CnGXc9BX.js:2 1.1; FunctionCall Ji.a ui-CnGXc9BX.js:2 1.0)
- 1637 ms: 32.4 ms (Layout 12.4; FireAnimationFrame 5.2; FunctionCall tick 5.0; UpdateLayoutTree 3.6)
- 1680 ms: 28 ms ()
- 1710 ms: 23.5 ms (UpdateLayoutTree 13.4; EventDispatch 3.3; FunctionCall t overlay-C9eGFOvy.js:1 3.1; Layout 1.4)
- 1739 ms: 56.4 ms (TimerFire 56.4; FunctionCall s nav-gnhBjJsS.js:1 54.2; FunctionCall qu index-DRRjX-nH.js:36 1.1)
- 1812 ms: 101.3 ms (EventDispatch 79.7; FunctionCall after 79.7; UpdateLayoutTree 60.7; Layout 15.5)
- 1930 ms: 44.5 ms (v8.evaluateModule 43.8)
- 1975 ms: 213 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 31.5; Layout 26.2; UpdateLayoutTree 17.8; MinorGC 16.4)
- 2190 ms: 44.6 ms (FunctionCall controls-B4KCFOZ8.js:1 12.5; FunctionCall folder-viewer-BnaGrJKm.js:2 6.4; Layout 5.3; UpdateLayoutTree 4.3)
- 2267 ms: 9.2 ms ()
- 2281 ms: 16.7 ms (UpdateLayoutTree 7.9)
- 2304 ms: 7.7 ms ()
- 2332 ms: 21.2 ms ()
- 2381 ms: 279.2 ms (v8.evaluateModule 278.0)
- 2661 ms: 146.2 ms (Layout 13.8; FunctionCall 1.3; UpdateLayoutTree 1.2)
- 2807 ms: 20.7 ms (FireAnimationFrame 3.3; FunctionCall e markup-DQhNIXfG.js:1 3.3; FireAnimationFrame 2.2; FunctionCall a markup-DQhNIXfG.js:1 2.2)
- 2885 ms: 13.6 ms (FireAnimationFrame 5.1; FunctionCall a markup-DQhNIXfG.js:1 5.1; Paint 4.9; Paint 3.8)
- 2917 ms: 1352 ms (Receive mojo message 1351.9; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 1327.3; Layout 231.5; Layout 176.6)
- 4275 ms: 103.3 ms (PrePaint 31.2; Paint 25.0; Paint 23.6; FunctionCall 11.4)
- 4402 ms: 7.4 ms (Receive mojo message 7.3)
- 5326 ms: 8 ms (FireAnimationFrame 3.8; FunctionCall e markup-DQhNIXfG.js:1 3.4; FireAnimationFrame 2.4; FunctionCall tick 2.3)
