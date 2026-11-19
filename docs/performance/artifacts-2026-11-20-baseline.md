# Sheet and paper benchmark, 2026-11-19T19:19Z

Headless Chrome 156.0.8078.79 at 1600x1000, DPR 1, against http://127.0.0.1:4310 (0.8.12-dev.20261119185158.g5c74f22, then 0.8.12-dev.20261119192000.g7a489aa: the server changed during the run); medians of 5 runs. Headless numbers, not the owner's Windows Chrome; the background off. Pop-ins count what is visible in the artifact's pane.

## sheet 1x (load average 3.6, 2.1, 2, 1.9, 1.9)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 567 | 1435 | 113 | 881 | 0.0641 | 34 | 230.5 | none |
| warm | 415 | 990 | 111 | 493 | 0.0615 | 29 | 113.1 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 1 | 11.6 | 4.7 | 2000x2197 |
| arrows across 50 cells | 50 | 18.9 | 239.4 | Z28 |
| type 20 characters, commit | 3 | 21.7 | 15 | bench typing twenty! |
| open the cell menu | 3 | 97.4 | 92.7 | true |
| open a ribbon dropdown | 1 | 14 | 7.1 | false |
| select 1,000 cells by drag | 103 | 20.8 | 310.6 | A1:AH100 (3400), A:Z (910), A:Y (875) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 772 resizes div.ui-header-group (16x16 → 124x30)
- 772 appears button.ui-button[Comments] (28x28)
- 772 appears button.ui-button[Comments] > svg (16x16)
- 772 appears button.ui-button[Agents] (16x28)
- 772 appears button.ui-button[Agents] > svg (16x16)
- 772 appears button.ui-button[Open the thread beside] (28x28)
- 772 appears button.ui-button[Open the thread beside] > svg (16x16)
- 771 shifts div.ui-header-group (108px, 16 → 30 high)
- 797 appears button.ui-button[Open the thread beside] > svg (16x16)
- 813 resizes div.ui-header-group (124x30 → 187x30)
- 813 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 813 appears span.ui-setting-value.ui-truncate (42x19)
- 813 shifts div.ui-header-group (63px, 30 → 30 high)
- 1163 resizes div.ui-header-group (187x30 → 169x30)
- 1163 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 1163 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 1163 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 1163 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 1163 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 1163 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 1163 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 1163 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 1163 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 1163 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 1163 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1163 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1163 appears div.ui-spreadsheet-rows > div (936x896)
- 1163 appears div.ui-spreadsheet-rows > div (936x896)
- 1164 appears div.ui-markup-rails (1020x36)
- 1164 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 1164 appears span.ui-markup-with (74x36)
- 1164 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 1164 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 1164 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 1164 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 1164 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 1164 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 1164 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 1164 appears span.ui-title-text.ui-markup-caption (27x15)
- 1164 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 1164 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 1164 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 1164 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 1164 appears button.ui-icon-button[Underline] (36x36)
- 1164 appears button.ui-icon-button[Underline] > svg (14x14)
- 1164 appears button.ui-icon-button[Align: Align left] (36x36)
- 1164 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 1164 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 1164 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 1164 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 1164 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 1164 appears button.ui-icon-button[Borders: All borders] (36x36)
- 1164 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 1164 appears button.ui-icon-button[Merge] (36x36)
- 1164 appears button.ui-icon-button[Merge] > svg (14x14)
- 1164 appears button.ui-icon-button[Chart] (36x36)
- 1164 appears button.ui-icon-button[Chart] > svg (14x14)
- 1164 appears button.ui-icon-button[Number format] (36x36)
- 1164 appears button.ui-icon-button[Number format] > svg (14x14)
- 1164 appears button.ui-icon-button[Vertical align: Align middle] (36x36)
- … 49 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 211 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 212 animation ui-spin span.ui-spinner
- 212 resizes div.ui-header-title (47x18 → 76x18)
- 212 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 212 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 317 resizes div.ui-header-group (16x16 → 124x30)
- 318 appears button.ui-button[Comments] (28x28)
- 318 appears button.ui-button[Comments] > svg (16x16)
- 318 appears button.ui-button[Agents] (16x28)
- 318 appears button.ui-button[Agents] > svg (16x16)
- 318 appears button.ui-button[Open the thread beside] (28x28)
- 318 appears button.ui-button[Open the thread beside] > svg (16x16)
- 317 shifts span.ui-status.ui-size-icon[Opening the sheet] (108px, 16 → 16 high)
- 362 resizes div.ui-header-group (124x30 → 187x30)
- 362 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 362 appears button.ui-button[Open the thread beside] > svg (16x16)
- 362 appears span.ui-setting-value.ui-truncate (42x19)
- 361 shifts div.ui-header-group (63px, 30 → 30 high)
- 545 resizes div.ui-header-group (187x30 → 169x30)
- 545 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 545 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 545 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 545 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 545 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 545 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 545 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 545 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 545 appears div.ui-spreadsheet-views (936x798)
- 545 appears div.ui-spreadsheet-rows (936x798)
- 545 appears div.ui-spreadsheet-rows > div (936x798)
- 545 appears div.ui-spreadsheet-rows > div (936x798)
- 545 appears div.ui-markup-rails (1020x36)
- 545 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 545 appears span.ui-markup-with (74x36)
- 545 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 545 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 545 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 545 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 545 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 545 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 545 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 545 appears span.ui-title-text.ui-markup-caption (27x15)
- 545 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 545 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 545 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 545 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 545 appears button.ui-icon-button[Underline] (36x36)
- 545 appears button.ui-icon-button[Underline] > svg (14x14)
- 545 appears button.ui-icon-button[Align: Align left] (36x36)
- 545 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 546 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 546 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 546 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 546 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 546 appears button.ui-icon-button[Borders: All borders] (36x36)
- 546 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 546 appears button.ui-icon-button[Merge] (36x36)
- 546 appears button.ui-icon-button[Merge] > svg (14x14)
- 546 appears button.ui-icon-button[Chart] (36x36)
- 546 appears button.ui-icon-button[Chart] > svg (14x14)
- … 51 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 331–354 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 387–395 /assets/artifact-pane-Dmlo93ut.js 3844
- 389–398 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 390–398 /assets/markup-DQhNIXfG.js 30426
- 390–396 /assets/markup-CDnU5VZp.css 2750
- 391–398 /assets/artifacts-CI_2_mC0.js 1347
- 441–449 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 474–498 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 572–897 /assets/workspace-panel-CTLda2YA.js 8094
- 573–898 /assets/folder-viewer-BnaGrJKm.js 18556
- 574–908 /assets/file-marks-Bfkac6qr.js 82704
- 575–912 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 575–906 /assets/direct-files-D0yQ2M2_.js 2669
- 575–905 /assets/editor-DOyaF3iH.js 605
- 576–895 /assets/folder-viewer-3pEjijTT.css 159
- 577–924 /assets/list-collapse-NQttQipY.js 249
- 577–912 /assets/terminal-pane-Bh6ct0EM.js 12925
- 577–925 /assets/terminal-font-CqS09iKD.js 242
- 577–903 /assets/terminal-pane-C0-Hx5v3.css 420
- 591–925 /assets/artifact-rows-FX4kYm2n.js 1525
- 622–954 /assets/sheet-surface-Buy4kSAi.js 85115
- 622–954 /assets/sheet-display-Cuv0NGIg.js 496
- 622–977 /assets/document-format-cm8fv2KG.js 197575
- 622–962 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 623–962 /assets/grid-2x2-0uAPdsry.js 258
- 623–977 /assets/list-B4oo_eXa.js 246
- 623–991 /assets/sheet-format-DFKRmz4W.js 3422
- 623–993 /assets/whole-word-BwoX5wq3.js 407
- 1498–undefined /assets/engine-worker-p_irKaFS.js 272935
- 1514–1524 /assets/charts-CSFDfsqu.js 5155
- 1515–1526 /assets/grid-BWVfDuJ9.js 134012
- 1515–1524 /assets/dist-Cn0wxr_l.js 5293
- 1515–1522 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 2 ms: 21.2 ms (ParseHTML  21.2)
- 36 ms: 10 ms (ParseAuthorStyleSheet 3.9)
- 50 ms: 18 ms (UpdateLayoutTree 6.3; FireAnimationFrame 2.9; FunctionCall tick 2.9)
- 138 ms: 266.8 ms (v8.evaluateModule 253.8; Layout 10.3; UpdateLayoutTree 9.1; MinorGC 4.0)
- 441 ms: 10.1 ms ()
- 452 ms: 11.6 ms (Layout 8.5; UpdateLayoutTree 1.2)
- 479 ms: 9.7 ms (FunctionCall e index-DRRjX-nH.js:88 1.8)
- 489 ms: 13 ms (Receive mojo message 12.3)
- 514 ms: 31.5 ms (MinorGC 3.0; V8.GC_SCAVENGER 2.9; V8.GC_SCAVENGER_SCAVENGE 2.8; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 2.3)
- 551 ms: 20.5 ms (FireAnimationFrame 18.6; UpdateLayoutTree 9.4; Layout 7.0)
- 580 ms: 7 ms (FireAnimationFrame 6.0; FunctionCall tick 6.0)
- 591 ms: 8 ms (Layout 5.0; EventDispatch 1.2; FunctionCall after 1.2)
- 836 ms: 7 ms (UpdateLayoutTree 2.0; FireAnimationFrame 1.9; FunctionCall tick 1.8)
- 881 ms: 13.4 ms (v8.evaluateModule 13.2)
- 894 ms: 129.1 ms (Layout 41.1; FunctionCall Ji.a ui-CnGXc9BX.js:2 12.7; UpdateLayoutTree 5.7; ParseHTML about:blank 4.8)
- 1027 ms: 9.4 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 3.9; FunctionCall controls-B4KCFOZ8.js:1 1.1)
- 1044 ms: 36.4 ms (TimerFire 36.4; FunctionCall s nav-gnhBjJsS.js:1 36.1; MinorGC 3.8; V8.GC_SCAVENGER 3.5)
- 1083 ms: 31.5 ms (EventDispatch 28.4; FunctionCall after 28.4; Layout 15.4; UpdateLayoutTree 12.8)
- 1116 ms: 19 ms ()
- 1137 ms: 12.3 ms (SimpleWatcher::OnHandleReady 12.3)
- 1156 ms: 122.6 ms (v8.evaluateModule 122.1; MinorGC 2.5; V8.GC_SCAVENGER 2.4; V8.GC_SCAVENGER_SCAVENGE 2.4)
- 1279 ms: 69.3 ms (Layout 6.4; UpdateLayoutTree 1.1)
- 1349 ms: 9.3 ms (FireAnimationFrame 1.5; FunctionCall a markup-DQhNIXfG.js:1 1.5; UpdateLayoutTree 1.5; PrePaint 1.1)
- 1410 ms: 57.7 ms (Receive mojo message 57.7; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 55.5; FunctionCall Ji.a ui-CnGXc9BX.js:2 1.3; Layout 1.1)
- 1511 ms: 35 ms (v8.evaluateModule 34.8)
- 1546 ms: 20.7 ms ()
- 1573 ms: 10.7 ms (FireAnimationFrame 7.0; FunctionCall a markup-DQhNIXfG.js:1 7.0; Layout 6.2; FireAnimationFrame 1.6)
- 1584 ms: 24.9 ms (SimpleWatcher::OnHandleReady 24.8; FunctionCall O grid-BWVfDuJ9.js:2 24.7)
- 1612 ms: 14.6 ms (FunctionCall O grid-BWVfDuJ9.js:2 14.3; Layout 5.0)
- 1626 ms: 8.3 ms ()
- 1635 ms: 125.3 ms (FireAnimationFrame 76.6; FunctionCall grid-BWVfDuJ9.js:139 74.2; FireAnimationFrame 17.3; FunctionCall a markup-DQhNIXfG.js:1 17.3)
- 1761 ms: 62 ms (FunctionCall O grid-BWVfDuJ9.js:2 61.9; Layout 2.6; UpdateLayoutTree 1.3)
- 1825 ms: 14.5 ms (FireAnimationFrame 1.4; FunctionCall tick 1.4)
- 1841 ms: 32.3 ms (FunctionCall O grid-BWVfDuJ9.js:2 32.2)
- 1874 ms: 22.1 ms ()
- 1930 ms: 20.5 ms (SimpleWatcher::OnHandleReady 20.5; FunctionCall O grid-BWVfDuJ9.js:2 20.4)
- 1954 ms: 11.5 ms ()
## sheet 4x (load average 2, 2, 1.9, 1.8, 1.8)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 1743 | 4308 | 113 | 2999 | 0.0641 | 58 | 737.4 | none |
| warm | 1528 | 2752 | 113 | 1441 | 0.0641 | 52 | 379 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| wheel 3,000 down, 2,000 across | 86 | 40.6 | 341.1 | 2000x2197 |
| arrows across 50 cells | 108 | 66.6 | 2176.9 | Z28 |
| type 20 characters, commit | 44 | 76.7 | 295.3 | bench typing twenty! |
| open the cell menu | 13 | 366.7 | 470.7 | true |
| open a ribbon dropdown | 15 | 90.4 | 183.2 | false |
| select 1,000 cells by drag | 213 | 64.2 | 3835.2 | A1:AM100 (3900) |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 171 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 228 animation ui-spin span.ui-spinner
- 236 resizes div.ui-header-title (47x18 → 76x18)
- 236 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 236 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 1156 resizes div.ui-header-group (16x16 → 124x30)
- 1156 appears button.ui-button[Comments] (28x28)
- 1157 appears button.ui-button[Comments] > svg (16x16)
- 1157 appears button.ui-button[Agents] (16x28)
- 1157 appears button.ui-button[Agents] > svg (16x16)
- 1157 appears button.ui-button[Open the thread beside] (28x28)
- 1157 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1155 shifts div.ui-header-group (108px, 16 → 30 high)
- 1269 resizes div.ui-header-group (124x30 → 187x30)
- 1269 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 1270 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1270 appears span.ui-setting-value.ui-truncate (42x19)
- 1269 shifts div.ui-header-group (63px, 30 → 30 high)
- 2034 resizes div.ui-header-group (187x30 → 169x30)
- 2035 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 2035 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 2035 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 2035 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 2035 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 2035 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 2035 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 2035 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 2035 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 2035 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 2035 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 2035 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 2035 appears div.ui-spreadsheet-rows > div (936x896)
- 2035 appears div.ui-spreadsheet-rows > div (936x896)
- 2035 appears div.ui-markup-rails (1020x36)
- 2035 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 2035 appears span.ui-markup-with (74x36)
- 2035 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 2035 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 2035 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 2035 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 2035 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 2035 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 2035 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 2036 appears span.ui-title-text.ui-markup-caption (27x15)
- 2036 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 2036 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 2036 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 2036 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 2036 appears button.ui-icon-button[Underline] (36x36)
- 2036 appears button.ui-icon-button[Underline] > svg (14x14)
- 2036 appears button.ui-icon-button[Align: Align left] (36x36)
- 2036 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 2036 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 2036 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 2036 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 2036 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 2036 appears button.ui-icon-button[Borders: All borders] (36x36)
- 2036 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 2037 appears button.ui-icon-button[Merge] (36x36)
- 2037 appears button.ui-icon-button[Merge] > svg (14x14)
- … 54 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 142 animation ui-spin span.ui-spinner
- 229 resizes div.ui-header-title (47x18 → 76x18)
- 229 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 76x18)
- 229 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 76x18)
- 433 resizes div.ui-header-group (16x16 → 124x30)
- 433 appears button.ui-button[Comments] (28x28)
- 433 appears button.ui-button[Comments] > svg (16x16)
- 433 appears button.ui-button[Agents] (16x28)
- 433 appears button.ui-button[Agents] > svg (16x16)
- 433 appears button.ui-button[Open the thread beside] (28x28)
- 433 appears button.ui-button[Open the thread beside] > svg (16x16)
- 432 shifts div.ui-header-group (108px, 16 → 30 high)
- 577 resizes div.ui-header-group (124x30 → 187x30)
- 577 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 577 appears button.ui-button[Open the thread beside] > svg (16x16)
- 577 appears span.ui-setting-value.ui-truncate (42x19)
- 576 shifts div.ui-header-group (63px, 30 → 30 high)
- 1103 resizes div.ui-header-group (187x30 → 169x30)
- 1104 resizes section.ui-spreadsheet[probe-sheet] (1256x984 → 1256x928)
- 1104 resizes div.ui-spreadsheet-bar (1240x36 → 1240x78)
- 1104 resizes div.ui-frost.ui-input (1074x34 → 1080x34)
- 1104 appears div.ui-formula-text[Formula] (1074x0 → 1080x0)
- 1104 appears div.ui-spreadsheet-slot (0x0 → 1020x36)
- 1104 resizes div.ui-spreadsheet-body (1256x896 → 1256x798)
- 1104 resizes div.ui-spreadsheet-grid (936x896 → 936x798)
- 1104 resizes aside.ui-spreadsheet-margin[Comments] (304x896 → 304x798)
- 1104 resizes div.ui-spreadsheet-views (936x896 → 936x798)
- 1104 resizes div.ui-spreadsheet-rows (936x896 → 936x798)
- 1104 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1104 resizes div.ui-spreadsheet-rows > div (936x896 → 936x798)
- 1104 appears div.ui-spreadsheet-rows > div (936x896)
- 1104 appears div.ui-spreadsheet-rows > div (936x896)
- 1104 appears div.ui-markup-rails (1020x36)
- 1104 appears div.ui-frost.ui-markup-bar[Mode] (116x34)
- 1104 appears span.ui-markup-with (74x36)
- 1105 appears button.ui-icon-button[Undo (Ctrl Z)] (36x36)
- 1105 appears button.ui-icon-button[Undo (Ctrl Z)] > svg (14x14)
- 1105 appears button.ui-icon-button[Redo (Ctrl Shift Z)] (36x36)
- 1105 appears button.ui-icon-button[Redo (Ctrl Shift Z)] > svg (14x14)
- 1105 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] (36x36)
- 1105 appears button.ui-icon-button[Ask the agent (Ctrl Alt M)] > svg (14x14)
- 1105 appears div.ui-frost.ui-markup-bar[Document tools] (749x34)
- 1105 appears span.ui-title-text.ui-markup-caption (27x15)
- 1105 appears button.ui-icon-button[Bold (Ctrl B)] (36x36)
- 1105 appears button.ui-icon-button[Bold (Ctrl B)] > svg (14x14)
- 1105 appears button.ui-icon-button[Italic (Ctrl I)] (36x36)
- 1105 appears button.ui-icon-button[Italic (Ctrl I)] > svg (14x14)
- 1105 appears button.ui-icon-button[Underline] (36x36)
- 1105 appears button.ui-icon-button[Underline] > svg (14x14)
- 1105 appears button.ui-icon-button[Align: Align left] (36x36)
- 1105 appears button.ui-icon-button[Align: Align left] > svg (14x14)
- 1105 appears button.ui-icon-button[Text colour: Default text] (36x36)
- 1106 appears button.ui-icon-button[Text colour: Default text] > svg (14x14)
- 1106 appears button.ui-icon-button[Fill colour: No fill] (36x36)
- 1106 appears button.ui-icon-button[Fill colour: No fill] > svg (14x14)
- 1106 appears button.ui-icon-button[Borders: All borders] (36x36)
- 1106 appears button.ui-icon-button[Borders: All borders] > svg (14x14)
- 1106 appears button.ui-icon-button[Merge] (36x36)
- 1106 appears button.ui-icon-button[Merge] > svg (14x14)
- 1106 appears button.ui-icon-button[Chart] (36x36)
- … 55 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 563–635 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 786–798 /assets/artifact-pane-Dmlo93ut.js 3844
- 796–803 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 797–803 /assets/markup-DQhNIXfG.js 30426
- 800–808 /assets/markup-CDnU5VZp.css 2750
- 806–810 /assets/artifacts-CI_2_mC0.js 1347
- 952–957 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1137–1140 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1171–1176 /assets/workspace-panel-CTLda2YA.js 8094
- 1174–1178 /assets/folder-viewer-BnaGrJKm.js 18556
- 1175–1186 /assets/file-marks-Bfkac6qr.js 82704
- 1176–1185 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1178–1183 /assets/direct-files-D0yQ2M2_.js 2669
- 1179–1184 /assets/editor-DOyaF3iH.js 605
- 1179–1185 /assets/folder-viewer-3pEjijTT.css 159
- 1182–1187 /assets/list-collapse-NQttQipY.js 249
- 1183–1189 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1189–1192 /assets/terminal-font-CqS09iKD.js 242
- 1190–1196 /assets/terminal-pane-C0-Hx5v3.css 420
- 1228–1233 /assets/artifact-rows-FX4kYm2n.js 1525
- 2084–2096 /assets/sheet-surface-Buy4kSAi.js 85115
- 2086–2092 /assets/sheet-display-Cuv0NGIg.js 496
- 2087–2101 /assets/document-format-cm8fv2KG.js 197575
- 2088–2089 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 2088–2095 /assets/grid-2x2-0uAPdsry.js 258
- 2090–2098 /assets/list-B4oo_eXa.js 246
- 2091–2099 /assets/sheet-format-DFKRmz4W.js 3422
- 2092–2098 /assets/whole-word-BwoX5wq3.js 407
- 3026–undefined /assets/engine-worker-p_irKaFS.js 272935
- 3078–3082 /assets/charts-CSFDfsqu.js 5155
- 3084–3089 /assets/grid-BWVfDuJ9.js 134012
- 3086–3088 /assets/dist-Cn0wxr_l.js 5293
- 3087–3089 /assets/grid-nthEL3fk.css 2012

Long tasks, cold load, last run:

- 9 ms: 12.2 ms ()
- 71 ms: 24.7 ms (ParseHTML  24.7; ParseAuthorStyleSheet 15.5)
- 96 ms: 18.4 ms (UpdateLayoutTree 15.1)
- 175 ms: 716 ms (v8.evaluateModule 682.2; UpdateLayoutTree 27.1; Layout 23.3; UpdateLayoutTree 9.3)
- 901 ms: 19 ms (FireAnimationFrame 3.3; FunctionCall m index-DRRjX-nH.js:88 3.3; UpdateLayoutTree 3.0; FunctionCall index-DRRjX-nH.js:57 2.5)
- 964 ms: 11.4 ms (Layout 7.7)
- 999 ms: 37.7 ms (Receive mojo message 35.9)
- 1049 ms: 11.3 ms ()
- 1060 ms: 103.3 ms ()
- 1170 ms: 58.2 ms (FireAnimationFrame 50.1; UpdateLayoutTree 40.0; EventDispatch 2.6; PrePaint 2.4)
- 1228 ms: 7.9 ms (DocumentLoader::CommitNavigation 1.1)
- 1243 ms: 44.8 ms (FunctionCall e index-DRRjX-nH.js:88 14.7; UpdateLayoutTree 4.7; MinorGC 4.5; V8.GC_SCAVENGER 3.4)
- 1288 ms: 10.7 ms ()
- 1328 ms: 22.3 ms (Layout 6.0; UpdateLayoutTree 5.1; Paint 3.1; Paint 2.9)
- 1391 ms: 10.6 ms ()
- 1410 ms: 22.1 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 17.3)
- 1445 ms: 10.5 ms (UpdateLayoutTree 2.3; Paint 1.8; Layout 1.2; Layerize 1.2)
- 1466 ms: 9.2 ms (v8.evaluateModule 9.0)
- 1475 ms: 24.9 ms (FunctionCall n ui-CnGXc9BX.js:2 1.4)
- 1516 ms: 26.4 ms (Layout 12.1; FireAnimationFrame 3.4; FunctionCall tick 3.4; UpdateLayoutTree 2.2)
- 1555 ms: 33.8 ms ()
- 1603 ms: 11.1 ms (UpdateLayoutTree 2.7; Layerize 1.4; EventDispatch 1.2; FunctionCall t overlay-C9eGFOvy.js:1 1.2)
- 1626 ms: 45.2 ms (TimerFire 44.3; FunctionCall s nav-gnhBjJsS.js:1 43.4; MinorGC 3.8; V8.GC_SCAVENGER 3.8)
- 1676 ms: 9.8 ms ()
- 1687 ms: 73.6 ms (EventDispatch 56.9; FunctionCall after 56.8; UpdateLayoutTree 42.1; Layout 12.6)
- 1761 ms: 27.5 ms (v8.evaluateModule 26.5)
- 1788 ms: 166.8 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 25.3; UpdateLayoutTree 10.6; Layout 9.3; FunctionCall ui-CnGXc9BX.js:2 9.1)
- 1956 ms: 32.6 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 9.0; FunctionCall controls-B4KCFOZ8.js:1 5.3; UpdateLayoutTree 3.3; FunctionCall 2.1)
- 1989 ms: 11.7 ms ()
- 2085 ms: 54.6 ms (MinorGC 4.9; V8.GC_SCAVENGER 4.9; V8.GC_SCAVENGER_SCAVENGE 4.8; V8.GC_SCAVENGER_SCAVENGE_PARALLEL_PHASE 2.2)
- 2143 ms: 26.6 ms (UpdateLayoutTree 8.8; Layout 7.8; Paint 2.3; PrePaint 1.9)
- 2184 ms: 255.6 ms (v8.evaluateModule 254.0; MinorGC 3.0; V8.GC_SCAVENGER 2.9; V8.GC_SCAVENGER_SCAVENGE 2.8)
- 2440 ms: 224.1 ms (UpdateLayoutTree 18.2; FunctionCall ui-CnGXc9BX.js:2 4.4; UpdateLayoutTree 4.0; Layout 3.4)
- 2665 ms: 17.1 ms (FireAnimationFrame 3.0; FunctionCall a markup-DQhNIXfG.js:1 3.0; FireAnimationFrame 2.2; FunctionCall e markup-DQhNIXfG.js:1 2.2)
- 2701 ms: 11.1 ms (Layerize 1.4; EventDispatch 1.1)
- 2729 ms: 8 ms (FunctionCall 1.0)
- 2742 ms: 18.8 ms ()
- 2760 ms: 7.3 ms (FunctionCall 1.2)
- 2768 ms: 23 ms (FireAnimationFrame 9.2; FunctionCall Ce markup-DQhNIXfG.js:1 9.2; UpdateLayoutTree 5.1; FireAnimationFrame 3.8)
- 2806 ms: 198.1 ms (Receive mojo message 198.1; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 186.6; FunctionCall Ji.a ui-CnGXc9BX.js:2 6.0; Layout 5.5)
- 3012 ms: 15.3 ms (FireAnimationFrame 7.1; FunctionCall a markup-DQhNIXfG.js:1 7.1; UpdateLayoutTree 7.0; PrePaint 1.6)
- 3029 ms: 8.3 ms (Receive mojo message 8.3; FunctionCall a.onmessage sheet-surface-Buy4kSAi.js:2 6.6)
- 3076 ms: 12.8 ms ()
- 3088 ms: 118.2 ms (v8.evaluateModule 117.4; Layout 1.4)
- 3207 ms: 65.3 ms (UpdateLayoutTree 1.3; UpdateLayoutTree 1.1; UpdateLayoutTree 1.0; UpdateLayoutTree 1.0)
- 3272 ms: 9.4 ms (FireAnimationFrame 2.7; FunctionCall a markup-DQhNIXfG.js:1 2.7; Layout 2.4; FireAnimationFrame 1.5)
- 3291 ms: 74.5 ms (SimpleWatcher::OnHandleReady 74.5; FunctionCall O grid-BWVfDuJ9.js:2 74.4; UpdateLayoutTree 1.1)
- 3367 ms: 7.2 ms (FireAnimationFrame 2.9; FunctionCall a markup-DQhNIXfG.js:1 2.9; UpdateLayoutTree 2.0)
- 3384 ms: 23 ms (FunctionCall O grid-BWVfDuJ9.js:2 22.5; UpdateLayoutTree 1.5)
- 3408 ms: 178.2 ms (FireAnimationFrame 104.5; FunctionCall grid-BWVfDuJ9.js:139 102.4; Layout 33.2; FunctionCall We markup-DQhNIXfG.js:1 4.7)
- 3591 ms: 125.1 ms (FunctionCall O grid-BWVfDuJ9.js:2 124.6; Layout 1.8; UpdateLayoutTree 1.2)
- 3719 ms: 36.7 ms (FireAnimationFrame 4.0; FunctionCall tick 3.9; Layerize 2.6; Paint 2.2)
- 3760 ms: 62.1 ms (FunctionCall O grid-BWVfDuJ9.js:2 62.1; Layout 1.2)
- 3824 ms: 25.8 ms (Layerize 2.4; FireAnimationFrame 1.2; FunctionCall charts-CSFDfsqu.js:1 1.2)
## paper 1x (load average 1.8, 1.5, 1, 0.8, 0.5)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 416 | 988 | 380 | 575 | 0.0032 | 17 | 171.3 | none |
| warm | 319 | 599 | 381 | 253 | 0.0002 | 14 | 81 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 7 | 15 | 19.4 | true |
| scroll its length | 11 | 11.8 | 17.5 | 17780 of 17780, 17833 of 17833, 17886 of 17886, 17939 of 17939, 17993 of 17993 |
| open the block menu | 2 | 30.5 | 30.4 | true |
| find | 17 | 56.9 | 177.1 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 43 animation ui-spin span.ui-spinner
- 44 resizes div.ui-header-title (47x18 → 88x18)
- 44 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 44 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 307 resizes div.ui-header-group (16x16 → 156x30)
- 307 resizes div.ui-empty (1224x896 → 1224x850)
- 307 appears button.ui-button[Comments] (28x28)
- 307 appears button.ui-button[Comments] > svg (16x16)
- 307 appears button.ui-button[Outline] (28x28)
- 307 appears button.ui-button[Outline] > svg (16x16)
- 307 appears button.ui-button[Agents] (16x28)
- 307 appears button.ui-button[Agents] > svg (16x16)
- 307 appears button.ui-button[Open the thread beside] (28x28)
- 307 appears button.ui-button[Open the thread beside] > svg (16x16)
- 307 appears div.ui-markup-room (1256x46)
- 307 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 584 resizes div.ui-header-group (156x30 → 201x30)
- 584 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 584 resizes div.ui-markup-room (1256x46 → 1256x54)
- 584 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 584 resizes div.ui-document-column (1232x964 → 1232x854)
- 584 resizes div.ui-document-page (1232x964 → 1232x17919)
- 584 resizes div.ui-document-body (760x816 → 760x17771)
- 584 resizes div.ui-document-content (760x816 → 760x17662)
- 584 appears button.ui-button[Open the thread beside] > svg (16x16)
- 584 appears span.ui-setting-value.ui-truncate (42x19)
- 584 appears header.ui-document-head (760x75)
- 584 appears input.ui-document-title[Name] (760x35)
- 584 appears button.ui-button.ui-document-add (109x28)
- 584 appears button.ui-button.ui-document-add > svg (16x16)
- 585 appears div.ui-answer.ui-document-text[bench scratch] (760x17662)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 585 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 321 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 41 animation ui-spin span.ui-spinner
- 42 resizes div.ui-header-title (47x18 → 88x18)
- 42 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 42 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 112 resizes div.ui-header-group (16x16 → 156x30)
- 112 resizes div.ui-empty (1224x896 → 1224x850)
- 112 appears button.ui-button[Comments] (28x28)
- 112 appears button.ui-button[Comments] > svg (16x16)
- 113 appears button.ui-button[Outline] (28x28)
- 113 appears button.ui-button[Outline] > svg (16x16)
- 113 appears button.ui-button[Agents] (16x28)
- 113 appears button.ui-button[Agents] > svg (16x16)
- 113 appears button.ui-button[Open the thread beside] (28x28)
- 113 appears button.ui-button[Open the thread beside] > svg (16x16)
- 113 appears div.ui-markup-room (1256x46)
- 112 shifts span.ui-status.ui-size-icon[Opening the paper] (140px, 16 → 16 high)
- 264 resizes div.ui-header-group (156x30 → 201x30)
- 264 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 264 resizes div.ui-markup-room (1256x46 → 1256x54)
- 264 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 264 resizes div.ui-document-column (1232x964 → 1232x854)
- 264 resizes div.ui-document-page (1232x964 → 1232x17919)
- 264 resizes div.ui-document-body (760x816 → 760x17771)
- 264 resizes div.ui-document-content (760x816 → 760x17662)
- 264 appears button.ui-button[Open the thread beside] > svg (16x16)
- 264 appears span.ui-setting-value.ui-truncate (42x19)
- 264 appears header.ui-document-head (760x75)
- 264 appears input.ui-document-title[Name] (760x35)
- 264 appears button.ui-button.ui-document-add (109x28)
- 264 appears button.ui-button.ui-document-add > svg (16x16)
- 264 appears div.ui-answer.ui-document-text[bench scratch] (760x17662)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 264 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 321 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 173–188 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 216–223 /assets/artifact-pane-Dmlo93ut.js 3844
- 218–226 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 218–226 /assets/markup-DQhNIXfG.js 30426
- 218–225 /assets/markup-CDnU5VZp.css 2750
- 219–226 /assets/artifacts-CI_2_mC0.js 1347
- 261–266 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 294–306 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 313–318 /assets/workspace-panel-CTLda2YA.js 8094
- 313–321 /assets/folder-viewer-BnaGrJKm.js 18556
- 314–323 /assets/file-marks-Bfkac6qr.js 82704
- 314–331 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 314–330 /assets/direct-files-D0yQ2M2_.js 2669
- 315–331 /assets/editor-DOyaF3iH.js 605
- 315–327 /assets/folder-viewer-3pEjijTT.css 159
- 315–336 /assets/list-collapse-NQttQipY.js 249
- 316–337 /assets/terminal-pane-Bh6ct0EM.js 12925
- 316–337 /assets/terminal-font-CqS09iKD.js 242
- 316–328 /assets/terminal-pane-C0-Hx5v3.css 420
- 329–337 /assets/artifact-rows-FX4kYm2n.js 1525
- 415–525 /assets/paper-surface-AQSmQhNk.js 39580
- 415–539 /assets/document-format-cm8fv2KG.js 197575
- 415–533 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 415–533 /assets/list-B4oo_eXa.js 246
- 416–536 /assets/unlink-B_vKUvuE.js 354
- 416–530 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 21 ms: 9.5 ms (ParseAuthorStyleSheet 7.2)
- 35 ms: 7.1 ms (UpdateLayoutTree 5.9)
- 74 ms: 173.5 ms (v8.evaluateModule 163.7; Layout 9.1; UpdateLayoutTree 7.0; UpdateLayoutTree 5.0)
- 283 ms: 30.2 ms ()
- 316 ms: 15.9 ms (FireAnimationFrame 14.3; UpdateLayoutTree 9.2; Layout 3.4)
- 373 ms: 13.8 ms (Receive mojo message 13.4)
- 395 ms: 9.8 ms (EventDispatch 7.3; FunctionCall after 7.2; Layout 5.4; UpdateLayoutTree 1.6)
- 407 ms: 8.3 ms (v8.evaluateModule 7.4; MinorGC 1.9; V8.GC_SCAVENGER 1.8; V8.GC_SCAVENGER_SCAVENGE 1.8)
- 416 ms: 36.5 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 6.9; UpdateLayoutTree 4.8; Layout 3.9; FunctionCall ui-CnGXc9BX.js:2 1.2)
- 453 ms: 7 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 2.2)
- 529 ms: 10 ms ()
- 567 ms: 58.9 ms (v8.evaluateModule 58.5)
- 626 ms: 37 ms (MinorGC 2.9; V8.GC_SCAVENGER 2.8; V8.GC_SCAVENGER_SCAVENGE 2.8; Layout 2.2)
- 685 ms: 6.9 ms (TimerFire 6.9; FunctionCall s nav-gnhBjJsS.js:1 6.6)
- 700 ms: 191.3 ms (Receive mojo message 191.3; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 187.2; Layout 34.1; UpdateLayoutTree 9.5)
- 893 ms: 66 ms (FireAnimationFrame 41.1; FunctionCall Ce markup-DQhNIXfG.js:1 40.5; Layout 22.3; Paint 7.4)
- 968 ms: 10.9 ms ()
## paper 4x (load average 0.7, 1.1, 1.2, 1.6, 2)

| Load | First paint ms | Usable ms | Pop-ins in pane | Last pop-in, ms after first | Shift score after first | Tasks > 6.94 ms | Longest ms | Dialogs open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 1515 | 3463 | 384 | 2041 | 0.0029 | 37 | 880.5 | none |
| warm | 1152 | 2251 | 383 | 1108 | 0.0029 | 32 | 471.5 | none |

| Interaction | Tasks > 6.94 ms | Longest ms | ms over budget | Did it |
| --- | --- | --- | --- | --- |
| type 200 characters mid-document | 345 | 77.5 | 3862.5 | true |
| scroll its length | 163 | 104.4 | 1355.7 | 18046 of 18046, 18099 of 18099, 18152 of 18152, 18178 of 18178, 18231 of 18231 |
| open the block menu | 10 | 177.9 | 285 | true |
| find | 30 | 340.9 | 1688.1 | true |

Visible pop-in in the pane, cold, last run (ms after first paint):

- 191 animation ui-arrive div.ui-sheet-fill.pane-artifact
- 259 animation ui-spin span.ui-spinner
- 268 resizes div.ui-header-title (47x18 → 88x18)
- 268 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 268 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 1089 resizes div.ui-header-group (16x16 → 156x30)
- 1090 resizes div.ui-empty (1224x896 → 1224x850)
- 1090 appears button.ui-button[Comments] (28x28)
- 1090 appears button.ui-button[Comments] > svg (16x16)
- 1090 appears button.ui-button[Outline] (28x28)
- 1090 appears button.ui-button[Outline] > svg (16x16)
- 1090 appears button.ui-button[Agents] (16x28)
- 1090 appears button.ui-button[Agents] > svg (16x16)
- 1090 appears button.ui-button[Open the thread beside] (28x28)
- 1090 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1090 appears div.ui-markup-room (1256x46)
- 1089 shifts div.ui-header-group (140px, 16 → 30 high)
- 1153 resizes div.ui-header-group (156x30 → 219x30)
- 1153 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 1153 appears button.ui-button[Open the thread beside] > svg (16x16)
- 1153 appears span.ui-setting-value.ui-truncate (42x19)
- 2120 resizes div.ui-header-group (219x30 → 201x30)
- 2121 resizes div.ui-markup-room (1256x46 → 1256x54)
- 2121 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 2121 resizes div.ui-document-column (1232x964 → 1232x854)
- 2121 resizes div.ui-document-page (1232x964 → 1232x18158)
- 2121 resizes div.ui-document-body (760x816 → 760x18010)
- 2121 resizes div.ui-document-content (760x816 → 760x17901)
- 2121 appears header.ui-document-head (760x75)
- 2121 appears input.ui-document-title[Name] (760x35)
- 2121 appears button.ui-button.ui-document-add (109x28)
- 2121 appears button.ui-button.ui-document-add > svg (16x16)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > pre (736x20)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > ul (736x55)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x26)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > h2 (760x24)
- 2122 appears div.ui-answer.ui-document-text[bench scratch] > p (760x53)
- … 324 more

Visible pop-in in the pane, warm, last run (ms after first paint):

- 232 animation ui-spin span.ui-spinner
- 269 resizes div.ui-header-title (47x18 → 88x18)
- 269 resizes nav.ui-header-crumb[breadcrumb] (47x18 → 88x18)
- 270 resizes nav.ui-header-crumb[breadcrumb] > strong (47x18 → 88x18)
- 448 resizes div.ui-header-group (16x16 → 156x30)
- 448 resizes div.ui-empty (1224x896 → 1224x850)
- 448 appears button.ui-button[Comments] (28x28)
- 448 appears button.ui-button[Comments] > svg (16x16)
- 448 appears button.ui-button[Outline] (28x28)
- 448 appears button.ui-button[Outline] > svg (16x16)
- 448 appears button.ui-button[Agents] (16x28)
- 448 appears button.ui-button[Agents] > svg (16x16)
- 448 appears button.ui-button[Open the thread beside] (28x28)
- 448 appears button.ui-button[Open the thread beside] > svg (16x16)
- 448 appears div.ui-markup-room (1256x46)
- 447 shifts div.ui-header-group (140px, 16 → 30 high)
- 547 resizes div.ui-header-group (156x30 → 219x30)
- 547 resizes button.ui-button[Agents: comments go to Thread] (16x28 → 79x28)
- 548 appears button.ui-button[Open the thread beside] > svg (16x16)
- 548 appears span.ui-setting-value.ui-truncate (42x19)
- 1062 resizes div.ui-header-group (219x30 → 201x30)
- 1063 resizes div.ui-markup-room (1256x46 → 1256x54)
- 1063 resizes section.ui-document[bench scratch] (1256x984 → 1256x874)
- 1063 resizes div.ui-document-column (1232x964 → 1232x854)
- 1063 resizes div.ui-document-page (1232x964 → 1232x18158)
- 1063 resizes div.ui-document-body (760x816 → 760x18010)
- 1063 resizes div.ui-document-content (760x816 → 760x17901)
- 1063 appears header.ui-document-head (760x75)
- 1063 appears input.ui-document-title[Name] (760x35)
- 1063 appears button.ui-button.ui-document-add (109x28)
- 1063 appears button.ui-button.ui-document-add > svg (16x16)
- 1063 appears div.ui-answer.ui-document-text[bench scratch] (760x17901)
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
- … 323 more

Chunks, cold, last run (ms from navigation, gzip bytes):

- 516–561 /assets/virtual_pwa-register-BQRfCRGp.js 603
- 695–707 /assets/artifact-pane-Dmlo93ut.js 3844
- 705–709 /assets/conduit-feedback-Bs1UMkVN.js 19176
- 706–711 /assets/markup-DQhNIXfG.js 30426
- 709–716 /assets/markup-CDnU5VZp.css 2750
- 714–718 /assets/artifacts-CI_2_mC0.js 1347
- 865–868 /assets/voice-dictation-diagnostics-CK0wbt3E.js 1281
- 1032–1035 /assets/workbox-window.prod.es5-Bd17z0YL.js 2216
- 1063–1068 /assets/workspace-panel-CTLda2YA.js 8094
- 1066–1069 /assets/folder-viewer-BnaGrJKm.js 18556
- 1067–1077 /assets/file-marks-Bfkac6qr.js 82704
- 1068–1074 /assets/workspace-shared-CO1Ap5sJ.js 7776
- 1070–1074 /assets/direct-files-D0yQ2M2_.js 2669
- 1071–1076 /assets/editor-DOyaF3iH.js 605
- 1073–1078 /assets/folder-viewer-3pEjijTT.css 159
- 1076–1082 /assets/list-collapse-NQttQipY.js 249
- 1077–1082 /assets/terminal-pane-Bh6ct0EM.js 12925
- 1080–1083 /assets/terminal-font-CqS09iKD.js 242
- 1081–1085 /assets/terminal-pane-C0-Hx5v3.css 420
- 1115–1121 /assets/artifact-rows-FX4kYm2n.js 1525
- 2065–2074 /assets/paper-surface-AQSmQhNk.js 39580
- 2067–2080 /assets/document-format-cm8fv2KG.js 197575
- 2068–2075 /assets/w3c-keyname-DUv0Ehb4.js 1127
- 2070–2079 /assets/list-B4oo_eXa.js 246
- 2071–2080 /assets/unlink-B_vKUvuE.js 354
- 2072–2081 /assets/paper-surface-CtlU648N.css 3531

Long tasks, cold load, last run:

- 7 ms: 7.9 ms ()
- 65 ms: 26.5 ms (ParseHTML  26.5; ParseAuthorStyleSheet 12.6; v8.compileModule transport-Ce3WewY7.js:1 1.3)
- 91 ms: 14.8 ms (UpdateLayoutTree 11.5)
- 150 ms: 644 ms (v8.evaluateModule 612.6; UpdateLayoutTree 29.3; Layout 24.9; UpdateLayoutTree 7.2)
- 799 ms: 18.2 ms (FunctionCall index-DRRjX-nH.js:57 2.5; FireAnimationFrame 2.4; FunctionCall m index-DRRjX-nH.js:88 2.4; Paint 2.4)
- 854 ms: 10.4 ms (Layout 8.2)
- 885 ms: 40.6 ms (Receive mojo message 38.9)
- 939 ms: 9.8 ms ()
- 948 ms: 97.4 ms ()
- 1052 ms: 54 ms (FireAnimationFrame 46.2; UpdateLayoutTree 37.0; Layout 3.1; EventDispatch 3.0)
- 1107 ms: 8.8 ms ()
- 1123 ms: 32.6 ms (FunctionCall e index-DRRjX-nH.js:88 10.6; MinorGC 3.5; V8.GC_SCAVENGER 3.4; V8.GC_SCAVENGER_SCAVENGE 3.4)
- 1156 ms: 11.9 ms ()
- 1208 ms: 24.7 ms (Layout 6.8; UpdateLayoutTree 4.4; Paint 3.5; Paint 2.9)
- 1265 ms: 12.3 ms ()
- 1303 ms: 26.7 ms (FunctionCall D.t.onmessage index-DRRjX-nH.js:62 22.1)
- 1333 ms: 12.7 ms (UpdateLayoutTree 3.5; EventDispatch 1.4; FunctionCall after 1.3; Paint 1.2)
- 1348 ms: 18.2 ms (v8.evaluateModule 15.0)
- 1367 ms: 34.7 ms ()
- 1411 ms: 34.5 ms (Layout 12.9; FireAnimationFrame 5.0; FunctionCall tick 5.0; UpdateLayoutTree 2.9)
- 1465 ms: 35 ms (FunctionCall 1.4)
- 1505 ms: 14.1 ms (UpdateLayoutTree 3.5; Layerize 2.4; FireAnimationFrame 1.3; FunctionCall index-DRRjX-nH.js:94 1.3)
- 1524 ms: 52 ms (TimerFire 52.0; FunctionCall s nav-gnhBjJsS.js:1 50.0)
- 1592 ms: 10.3 ms ()
- 1605 ms: 88.4 ms (EventDispatch 69.2; FunctionCall after 69.2; UpdateLayoutTree 51.3; Layout 15.0)
- 1704 ms: 40.6 ms (v8.evaluateModule 39.7)
- 1745 ms: 178.3 ms (FunctionCall Ji.a ui-CnGXc9BX.js:2 22.2; Layout 12.6; UpdateLayoutTree 12.1; FunctionCall ui-CnGXc9BX.js:2 7.1)
- 1926 ms: 35.3 ms (FunctionCall folder-viewer-BnaGrJKm.js:2 12.0; FunctionCall controls-B4KCFOZ8.js:1 5.3; FunctionCall 3.6; UpdateLayoutTree 2.1)
- 1963 ms: 10.4 ms ()
- 2073 ms: 45.2 ms (FunctionCall 1.1)
- 2121 ms: 26.1 ms (Layout 8.0; UpdateLayoutTree 7.1; Paint 3.9; FunctionCall 2.8)
- 2160 ms: 213 ms (v8.evaluateModule 211.0; MinorGC 6.7; V8.GC_SCAVENGER 6.7; V8.GC_SCAVENGER_SCAVENGE 5.0)
- 2373 ms: 118.8 ms (Layout 13.6; FunctionCall next 1.2; FunctionCall 1.2; UpdateLayoutTree 1.0)
- 2494 ms: 16.9 ms (PrePaint 2.3; FireAnimationFrame 2.1; FunctionCall e markup-DQhNIXfG.js:1 2.1; FireAnimationFrame 2.0)
- 2562 ms: 10 ms (FireAnimationFrame 4.7; FunctionCall a markup-DQhNIXfG.js:1 4.7; UpdateLayoutTree 2.6; Layout 1.9)
- 2586 ms: 920.6 ms (Receive mojo message 920.6; FunctionCall i.onmessage paper-surface-AQSmQhNk.js:2 902.9; Layout 165.1; Layout 138.0)
- 3511 ms: 72.9 ms (Paint 18.0; Paint 17.2; FunctionCall 14.7; PrePaint 13.0)
