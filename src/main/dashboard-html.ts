// The KRH Dashboard page (one self-contained document, loaded as a data: URL). Everything it shows comes from the
// main process through window.krhDash.call('dash:...'); file names are only ever put on the page as text.

import { FONTS } from '../shared/look-options';
import { MATERIAL_ICONS_WOFF2 } from './material-icons-font';

const CSS = `
@font-face{font-family:'Material Icons';font-style:normal;font-weight:400;src:url(${MATERIAL_ICONS_WOFF2}) format('woff2')}
.material-icons{font-family:'Material Icons';font-weight:400;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';-webkit-font-feature-settings:'liga';-webkit-font-smoothing:antialiased}
:root{--bgfx:radial-gradient(1200px 700px at 15% 10%,#2a1b5e 0%,transparent 60%),radial-gradient(900px 600px at 90% 90%,#0e3b55 0%,transparent 55%),#120c28;--bg:#120c28;--panel:rgba(20,14,44,.78);--line:rgba(255,255,255,.16);--ink:#f7f4ff;--dim:#cfc9e8;--acc:#35d6ff;--acc2:#8b5cf6;--bad:#ff5d6c}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--bg);overflow:hidden}
#bg{position:fixed;inset:0;background:var(--bgfx);background-size:cover;background-position:center}
#dim{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none}
#app{position:relative;display:flex;flex-direction:column;height:100%}
nav{width:220px;flex:none;padding:18px 12px;display:flex;flex-direction:column;gap:6px;background:var(--panel);border-right:1px solid var(--line);backdrop-filter:blur(8px)}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 16px;font-weight:700;font-size:16px}
.brand i{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--acc2),var(--acc));display:block}
nav button{all:unset;cursor:pointer;display:block;padding:10px 12px;border-radius:9px;color:var(--dim);font-weight:600}
nav button:hover{background:rgba(255,255,255,.06);color:var(--ink)}
nav button.on{background:rgba(53,214,255,.12);color:var(--acc);box-shadow:inset 0 0 0 1px rgba(53,214,255,.35)}
nav #restartBtn{color:var(--ink);box-shadow:inset 0 0 0 1px var(--line);text-align:center}nav #restartBtn:hover{box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc)}
nav .sp{flex:1}.ver{padding:8px 12px;color:var(--dim);font-size:12px}
main{flex:1;overflow:auto;padding:26px 30px;scrollbar-color:#4b3b8a transparent;scrollbar-width:thin}
h1{margin:0 0 4px;font-size:20px;letter-spacing:.04em;text-transform:uppercase}
.sub{color:var(--dim);margin:0 0 18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px;backdrop-filter:blur(8px)}
.card h2{margin:0 0 2px;font-size:15px}.card p{margin:0 0 10px;color:var(--dim)}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.btn{all:unset;cursor:pointer;padding:8px 14px;border-radius:9px;background:linear-gradient(135deg,var(--acc2),var(--acc));color:#06101c;font-weight:700}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px var(--line)}
.btn.ghost:hover{box-shadow:inset 0 0 0 1px var(--acc)}.btn.bad{background:transparent;color:var(--bad);box-shadow:inset 0 0 0 1px rgba(255,93,108,.5)}
.btn:hover{filter:brightness(1.1)}.btn:disabled{opacity:.4;cursor:default;filter:none}
.list{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.item{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid var(--line)}
.item .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item .meta{color:var(--dim);font-size:12px}
.empty{padding:18px;text-align:center;color:var(--dim);border:1px dashed var(--line);border-radius:9px}
.sw{position:relative;width:42px;height:24px;flex:none;border-radius:12px;background:rgba(255,255,255,.14);cursor:pointer;transition:.15s}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s}
.sw.on{background:var(--acc)}.sw.on::after{left:21px}
.x{all:unset;cursor:pointer;color:var(--dim);padding:2px 8px;border-radius:6px}.x:hover{color:var(--bad);background:rgba(255,93,108,.12)}
select,input[type=text],input[type=range]{font:inherit;color:var(--ink)}
select,input[type=text]{background:rgba(255,255,255,.07);border:1px solid var(--line);border-radius:8px;padding:7px 10px;min-width:220px}
select option{color:#000}
nav button{padding:8px 12px}nav{gap:3px;overflow:auto}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.ping-good{color:#5dffa0}.ping-mid{color:#ffd35d}.ping-bad{color:#ff7d7d}
.star{all:unset;cursor:pointer;font-size:18px;color:var(--dim)}.star.on{color:#ffd35d}
pre.diag{white-space:pre-wrap;word-break:break-word;max-height:55vh;overflow:auto;background:rgba(0,0,0,.35);border:1px solid var(--line);border-radius:10px;padding:12px;font:12px/1.45 Consolas,monospace;margin:10px 0 0}
.md h1,.md h2,.md h3{margin:12px 0 4px}.md h1{font-size:18px}.md h2{font-size:16px}.md h3{font-size:14px}.md ul{margin:4px 0 8px 18px;padding:0}.md li{margin:2px 0}.md a{color:var(--acc)}
.stat{display:flex;gap:22px;flex-wrap:wrap}.stat div b{display:block;font-size:20px}.stat div span{color:var(--dim);font-size:12px}
.kbd{font:12px Consolas,monospace;background:rgba(255,255,255,.08);border:1px solid var(--line);border-radius:6px;padding:2px 8px}

.vercard{display:flex;align-items:center;gap:16px}.vercard .big{font-size:26px;font-weight:800;letter-spacing:.02em}.vercard .sm{color:var(--dim);font-size:12.5px}
.note{display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px;border-radius:10px;background:rgba(53,214,255,.08);border:1px solid rgba(53,214,255,.3);color:var(--dim)}
#settHolder{min-height:420px;position:relative}
.ssearch{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 12px;border-radius:12px;background:var(--panel);border:1px solid var(--line);backdrop-filter:blur(10px)}
.ssearch:focus-within{border-color:var(--acc);box-shadow:0 0 0 2px rgba(53,214,255,.18)}
.ssearch .material-icons{color:var(--dim);font-size:20px}
.ssearch input[type=text]{flex:1;min-width:0;background:transparent;border:none;outline:none;padding:6px 2px}
.ssx{all:unset;cursor:pointer;color:var(--dim);font-size:20px;line-height:1;padding:2px 8px;border-radius:6px}.ssx:hover{color:var(--ink);background:rgba(255,255,255,.1)}
.ssc{color:var(--dim);font-size:12px;white-space:nowrap}
.snone{padding:18px;text-align:center;color:var(--dim);border:1px dashed var(--line);border-radius:9px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.tile{all:unset;cursor:pointer;display:block;padding:16px;border-radius:12px;background:var(--panel);border:1px solid var(--line)}
.tile:hover{border-color:var(--acc);transform:translateY(-1px)}.tile b{display:block;font-size:15px;margin-bottom:3px}.tile span{color:var(--dim);font-size:12.5px}
.toast{position:fixed;right:20px;bottom:20px;background:#1d1540;border:1px solid var(--acc);padding:10px 14px;border-radius:10px;opacity:0;transform:translateY(8px);transition:.2s;pointer-events:none}
.toast.show{opacity:1;transform:none}
body[data-fx=off] *{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}

#top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:12px 18px 6px}
#top .ttl{font-size:21px;font-weight:700;letter-spacing:.02em;line-height:1.15}#top .ttl small{display:block;margin-top:2px;font-size:12.5px;font-weight:600;color:var(--dim);letter-spacing:.06em}
#restartBtn{all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;color:var(--ink);font-weight:600;box-shadow:inset 0 0 0 1px var(--line);background:var(--panel);backdrop-filter:blur(8px)}#restartBtn:hover{box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc)}
#body{position:relative;display:flex;flex:1;min-height:0;padding:0 14px 14px;gap:14px}
#body nav{width:210px;border:1px solid var(--line);border-radius:16px;padding:14px 10px;margin:0}
#body nav .navh{text-align:center;font-weight:700;font-size:15px;padding:2px 0 10px;border-bottom:1px solid var(--line);margin-bottom:6px;letter-spacing:.04em}
#body nav .more{margin:10px 12px 2px;color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.1em}
#right{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
#pills{display:flex;gap:10px;flex-wrap:wrap}
#pills button{all:unset;cursor:pointer;padding:8px 18px;border-radius:999px;background:var(--panel);box-shadow:inset 0 0 0 1px var(--line);backdrop-filter:blur(8px);font-weight:600;color:var(--ink)}
#pills button:hover{box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc)}#pills button.play{background:linear-gradient(135deg,var(--acc2),var(--acc));color:#06101c;box-shadow:none}
#right main{flex:1;border:1px solid var(--line);border-radius:18px;background:var(--panel);backdrop-filter:blur(10px)}
#right main .card{background:rgba(255,255,255,.035)}
textarea.code{width:100%;min-height:260px;resize:vertical;margin:10px 0;background:rgba(0,0,0,.35);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:12px;font:12.5px/1.5 Consolas,"Courier New",monospace;tab-size:2;white-space:pre}
textarea.code:focus,input[type=text]:focus{outline:1px solid var(--acc)}
.edrow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.edrow label{color:var(--dim);font-size:12.5px;display:flex;align-items:center;gap:6px}
.item .ed{all:unset;cursor:pointer;color:var(--dim);padding:2px 8px;border-radius:6px}.item .ed:hover{color:var(--acc);background:rgba(53,214,255,.12)}
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-top:8px}
.theme-tile{all:unset;cursor:pointer;display:block;border-radius:12px;border:1px solid var(--line);padding:8px;background:rgba(255,255,255,.03)}
.theme-tile:hover{border-color:var(--acc)}.theme-tile.on{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}
.theme-tile i{display:block;height:64px;border-radius:8px;margin-bottom:8px;border:1px solid rgba(255,255,255,.1)}
.theme-tile b{display:block;font-size:14px}.theme-tile span{color:var(--dim);font-size:12px}
.theme-tile[data-t=aurora] i{background:radial-gradient(80px 50px at 20% 25%,#3ee0c0 0%,transparent 70%),radial-gradient(90px 60px at 85% 80%,#8b5cf6 0%,transparent 70%),#0b1424}
.theme-tile[data-t=midnight] i{background:radial-gradient(90px 60px at 80% 10%,#274a9a 0%,transparent 70%),#05070d}
.theme-tile[data-t=crimson] i{background:radial-gradient(90px 60px at 20% 20%,#c4234a 0%,transparent 70%),#12060a}
.theme-tile[data-t=emerald] i{background:radial-gradient(90px 60px at 75% 20%,#1fbf85 0%,transparent 70%),#06130f}
.theme-tile[data-t=sunset] i{background:radial-gradient(90px 60px at 20% 80%,#ff7a45 0%,transparent 70%),radial-gradient(90px 60px at 85% 15%,#d6457f 0%,transparent 70%),#1a0c14}
.theme-tile[data-t=slate] i{background:linear-gradient(135deg,#3a4152,#1b1f2a)}
body{--prgb:22,34,64;--pa:.54;--lift:.08;--bgb:1;--panel:rgba(var(--prgb),var(--pa));--dim:#cfc9e8}
body[data-theme=aurora]{--bg:#10203a;--bgfx:radial-gradient(900px 600px at 12% 8%,rgba(62,224,192,.55) 0%,transparent 62%),radial-gradient(1000px 700px at 92% 88%,rgba(139,92,246,.6) 0%,transparent 62%),radial-gradient(700px 400px at 60% 40%,rgba(53,214,255,.24) 0%,transparent 70%),#10203a;--prgb:24,40,72;--line:rgba(255,255,255,.2);--acc:#5cf2d0;--acc2:#8b5cf6}
body[data-theme=aurora] #right main{box-shadow:0 8px 40px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.16)}
body[data-theme=sky]{--bg:#1b4278;--bgfx:radial-gradient(900px 600px at 14% 4%,rgba(140,210,255,.75) 0%,transparent 62%),radial-gradient(1000px 700px at 92% 92%,rgba(140,150,255,.6) 0%,transparent 62%),linear-gradient(160deg,#2c6bb0,#1b4278);--prgb:34,70,122;--line:rgba(255,255,255,.28);--acc:#9be7ff;--acc2:#6f8cff}
body[data-theme=midnight]{--bg:#0b1020;--bgfx:radial-gradient(900px 600px at 82% 0%,#1d3678 0%,transparent 62%),radial-gradient(700px 500px at 10% 95%,#16295c 0%,transparent 62%),#0b1020;--prgb:16,24,46;--line:rgba(255,255,255,.14);--acc:#7aa6ff;--acc2:#3d63e0}
body[data-theme=crimson]{--bg:#1c0a10;--bgfx:radial-gradient(900px 600px at 15% 10%,#7a1a38 0%,transparent 62%),radial-gradient(800px 500px at 90% 90%,#4a1022 0%,transparent 62%),#1c0a10;--prgb:50,16,26;--line:rgba(255,255,255,.16);--acc:#ff6b8a;--acc2:#c4184a}
body[data-theme=emerald]{--bg:#0a1f19;--bgfx:radial-gradient(900px 600px at 80% 10%,#17775a 0%,transparent 62%),radial-gradient(800px 500px at 10% 90%,#0e4a38 0%,transparent 62%),#0a1f19;--prgb:12,48,38;--line:rgba(255,255,255,.16);--acc:#4af0b0;--acc2:#12a878}
body[data-theme=sunset]{--bg:#2a1220;--bgfx:radial-gradient(900px 600px at 15% 90%,#b4531e 0%,transparent 62%),radial-gradient(900px 600px at 90% 10%,#933066 0%,transparent 62%),#2a1220;--prgb:58,24,46;--line:rgba(255,255,255,.18);--acc:#ffc065;--acc2:#ff6a7c}
body[data-theme=slate]{--bg:#222834;--bgfx:linear-gradient(135deg,#363e50 0%,#1d222d 100%);--prgb:44,52,68;--line:rgba(255,255,255,.14);--acc:#b4c8e8;--acc2:#6f83a6}
.theme-tile[data-t=sky] i{background:radial-gradient(80px 50px at 20% 20%,#9be7ff 0%,transparent 70%),linear-gradient(160deg,#2c6bb0,#1b4278)}

/* ── lift, glass and motion ── */
/* Brightness / glass come from the Themes page (--lift, --bgb, --pa are set by the page script). */
#bg{filter:brightness(var(--bgb));transition:filter .3s}
#glow{position:fixed;inset:-6%;pointer-events:none;background:radial-gradient(520px 360px at 22% 28%,rgba(92,242,208,.22),transparent 70%),radial-gradient(560px 380px at 78% 72%,rgba(139,92,246,.26),transparent 70%);mix-blend-mode:screen}
#top .ttl .grad,.vercard .big{background:linear-gradient(90deg,#ffffff 0%,var(--acc) 45%,#ffffff 90%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent}
.card,#body nav,#right main,#pills button,.tile,#restartBtn{background-image:linear-gradient(rgba(255,255,255,var(--lift)),rgba(255,255,255,var(--lift)))}
#right main .card{background-color:rgba(255,255,255,.05)}
.card,.tile,.item,.theme-tile{transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease,background-color .25s ease}
.item:hover{border-color:rgba(255,255,255,.28);background-color:rgba(255,255,255,.08)}
.tile{position:relative;overflow:hidden}
.tile::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.16) 50%,transparent 70%);transform:translateX(-120%);transition:transform .6s ease}
.tile:hover{transform:translateY(-4px) scale(1.02);border-color:var(--acc);box-shadow:0 16px 32px -14px var(--acc)}
.tile:hover::after{transform:translateX(120%)}.tile:active{transform:translateY(-1px) scale(.98)}
.theme-tile:hover{transform:translateY(-3px)}.theme-tile.on{transform:scale(1.02)}
.btn,#pills button,#restartBtn,nav button{position:relative;overflow:hidden;transition:transform .18s ease,filter .18s ease,box-shadow .25s ease,background-color .2s ease,color .2s ease}
.btn:hover,#pills button:hover,#restartBtn:hover{transform:translateY(-2px)}
.btn:not(.ghost):not(.bad):hover{box-shadow:0 10px 22px -8px var(--acc)}
.btn:active,#pills button:active,#restartBtn:active{transform:translateY(0) scale(.96)}
nav button:hover{transform:translateX(4px)}
nav button.on::before{content:"";position:absolute;left:0;top:22%;bottom:22%;width:3px;border-radius:3px;background:var(--acc);box-shadow:0 0 10px var(--acc)}
.rip{position:absolute;border-radius:50%;background:rgba(255,255,255,.45);pointer-events:none;transform:scale(0);animation:krhRip .6s ease-out forwards}
.sw{transition:background .25s ease,box-shadow .25s ease}.sw::after{transition:left .28s cubic-bezier(.3,1.5,.5,1),width .15s}
.sw.on{box-shadow:0 0 12px -2px var(--acc)}.sw:active::after{width:22px}
.toast{transform:translateY(16px) scale(.96);transition:opacity .25s ease,transform .35s cubic-bezier(.2,1.4,.4,1)}.toast.show{transform:none}
.look-row{display:flex;align-items:center;gap:12px;margin:8px 0;flex-wrap:wrap}.look-row label{width:130px;color:var(--dim);font-size:12.5px}.look-row input[type=range]{flex:1;min-width:160px;accent-color:var(--acc)}.look-row output{width:38px;text-align:right;color:var(--dim);font-size:12.5px}
.chip{all:unset;cursor:pointer;padding:6px 14px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line);font-weight:600;font-size:12.5px;transition:transform .18s ease,box-shadow .2s ease,color .2s ease}.chip:hover{box-shadow:inset 0 0 0 1px var(--acc);color:var(--acc);transform:translateY(-2px)}
.tip{display:flex;align-items:center;gap:14px}.tip .material-icons{font-size:30px;color:var(--acc)}.tip>div{flex:1}.tip p{margin:2px 0 0}
tr.hl td{background:rgba(53,214,255,.1)}tr.hl td:first-child{box-shadow:inset 3px 0 0 var(--acc)}

.drrow{display:block;position:relative;margin:8px 0;padding:10px 14px 10px 16px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid var(--line)}
.drrow::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--lv,#7aa6ff)}
.drrow b{display:block;margin-bottom:2px}.drrow span{color:var(--dim);font-size:12.5px;line-height:1.5}
.drrow.ok{--lv:#5cf2a8}.drrow.info{--lv:#7aa6ff}.drrow.warn{--lv:#ffc065}.drrow.bad{--lv:#ff6b8a}
.drsum{margin:8px 0 0;font-weight:700}
.newscard h2{margin-bottom:4px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.tag{padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.08);font-size:11.5px;color:var(--dim)}
#guardCard{border-color:#ffc065}#guardCard h2{color:#ffc065}
.look-row select,.look-row input[type=text]{flex:1;min-width:160px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--ink);font:inherit}
.look-row input[type=color]{width:46px;height:34px;border:none;background:none;padding:0;cursor:pointer}
body[data-ufont] *:not(.material-icons):not(code):not(pre):not(textarea.code):not(.kbd){font-family:var(--ufont) !important}
@keyframes krhRise{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
@keyframes krhSlide{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes krhDrift{0%{transform:translate(0,0) scale(1)}100%{transform:translate(2.5%,-2%) scale(1.07)}}
@keyframes krhShimmer{0%{background-position:0 0}100%{background-position:220% 0}}
@keyframes krhPulse{0%,100%{box-shadow:0 0 0 0 rgba(91,200,255,.5)}60%{box-shadow:0 0 0 10px rgba(91,200,255,0)}}
@keyframes krhRip{to{transform:scale(3);opacity:0}}
@keyframes krhBar{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes krhWake{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
@keyframes krhWiggle{0%,100%{transform:rotate(0)}30%{transform:rotate(-10deg) scale(1.1)}65%{transform:rotate(8deg) scale(1.1)}}
body[data-anim=on] #glow{animation:krhDrift 16s ease-in-out infinite alternate}
body[data-anim=on] #top .ttl .grad,body[data-anim=on] .vercard .big{animation:krhShimmer 9s linear infinite}
body[data-anim=on] #top{animation:krhRise .5s cubic-bezier(.2,.8,.2,1) backwards}
body[data-anim=on] #body nav{animation:krhSlide .55s cubic-bezier(.2,.8,.2,1) .05s backwards}
body[data-anim=on] #body nav button,body[data-anim=on] #body nav .more{animation:krhSlide .4s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*30ms + 150ms)}
body[data-anim=on] #pills button{animation:krhRise .5s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*60ms + 120ms)}
body[data-anim=on] #right main{animation:krhRise .6s cubic-bezier(.2,.8,.2,1) .1s backwards}
body[data-anim=on] main section:not([hidden]) > :not(.grid):not(.tgrid){animation:krhRise .5s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*55ms)}
body[data-anim=on] .grid .tile,body[data-anim=on] .tgrid .theme-tile{animation:krhRise .5s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*55ms + 160ms)}
body[data-anim=on] .tile:hover b{animation:krhWiggle .6s ease}
body[data-anim=on] .item{animation:krhRise .4s cubic-bezier(.2,.8,.2,1) backwards;animation-delay:calc(var(--i,0)*40ms)}
body[data-anim=on] #gLast .btn{animation:krhPulse 2.4s ease-out infinite}
body[data-anim=on] nav button.on::before{animation:krhBar .3s ease}
body[data-anim=on] #app.wake{animation:krhWake .45s cubic-bezier(.2,.8,.2,1)}
body[data-anim=off] *{animation:none !important;transition:none !important}
/* With the FPS limit removed a window with an endless animation renders flat out, so they pause when the window is not in front. */
body.idle *,body.idle *::before,body.idle *::after{animation-play-state:paused !important}

`;

const BODY = `
<div id="bg"></div><div id="glow"></div><div id="dim"></div>
<div id="app">
 <div id="top"><div class="ttl"><span class="grad">Krunker Resource Hub Client</span><small id="ver">v</small></div><button id="restartBtn" title="Close and start KRH Client again">Restart Client</button></div>
 <div id="body">
 <nav>
  <div class="navh">Dashboard</div>
  <button data-p="home" class="on">Home</button>
  <button data-p="css">Custom CSS</button>
  <button data-p="scripts">Userscripts</button>
  <button data-p="swapper">Resource Swapper</button>
  <button data-p="settings">Client Settings</button>
  <div class="more">More</div>
  <button data-p="themes">Themes</button>
  <button data-p="news">Krunker news</button>
  <button data-p="live">Live Data</button>
  <button data-p="servers">Servers</button>
  <button data-p="history">History</button>
  <button data-p="profiles">Profiles</button>
  <button data-p="keybinds">Keybinds</button>
  <button data-p="diag">Diagnostics</button>
  <button data-p="logs">Logs</button>
  <button data-p="updates">What's new</button>
  <button data-p="look">Maintenance</button>
 </nav>
 <div id="right">
 <div id="pills"><button class="play" data-open="play">Open Krunker (Play)</button><button data-open="hub">KRH</button><button data-open="social">Krunker Social</button><button data-open="editor">Krunker Editor</button><button data-open="viewer">Krunker Viewer</button><button data-open="sandbox">Krunker Sandbox</button></div>
 <main>
  <section id="p-home">
   <h1>Home</h1><p class="sub">Jump straight to the game, the KRH website or the places people ask for most.</p>
   <div class="card vercard"><div><div class="big" id="verBig">KRH Client</div><div class="sm" id="verSub"></div></div></div>
   <div class="card tip"><span class="material-icons">keyboard</span><div><h2>Dashboard shortcut</h2><p>The dashboard is hidden while you play. Press <span class="kbd" id="tipKey">Ctrl+Shift+D</span> in the game to open it over the game, and press it again (or click back into the game) to go back. You can change the key in Client Settings &gt; General &gt; Hotkeys.</p></div><button class="btn ghost" data-go="keybinds">All keybinds</button></div>
   <div class="card" id="guardCard" hidden><h2>Scripts turned off</h2><p>These userscripts were switched off because the game crashed or kept failing after you added or changed them.</p><div class="list" id="guardList"></div></div>
   <div class="card" id="gamesCard"><h2>Games</h2><p>Jump back into the game you were in, or keep the ones you like.</p>
    <p style="margin:12px 0 6px">Have a game link? Paste it here and join.</p>
    <div class="row"><input type="text" id="gJoinUrl" placeholder="Paste a Krunker game link, for example krunker.io/?game=FRA:abc12" maxlength="300" autocomplete="off" spellcheck="false"><button class="btn" id="gJoinGo">Join game</button></div>
    <div class="row" style="margin:12px 0 4px;justify-content:space-between"><b>Recent games</b><button class="btn ghost" id="gClear">Clear</button></div>
     <div class="list" id="gLast"></div>
    <div class="row" style="margin-top:10px"><input type="text" id="gName" placeholder="Name for this game (optional)" maxlength="40"><button class="btn ghost" id="gSave">Save current game</button></div><div class="list" id="gFavs"></div></div>
   <div class="grid">
    <button class="tile" data-open="play"><b>Play Krunker</b><span>Open or bring up the game window</span></button>
    <button class="tile" data-open="hub"><b>KRH Website</b><span>Resources, guides, maps and community posts</span></button>
    <button class="tile" data-go="settings"><b>Client settings</b><span>All KRH Client options, right here</span></button>
    <button class="tile" data-link="https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/releases"><b>Releases</b><span>Download the newest KRH Client</span></button>
    <button class="tile" data-link="https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/issues"><b>Report a problem</b><span>Open an issue on GitHub</span></button>
    <button class="tile" data-link="https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client"><b>Source code</b><span>KRH Client on GitHub</span></button>
   </div>
  </section>
  <section id="p-scripts" hidden>
   <h1>Userscripts</h1><p class="sub">Write or paste a script here and it is switched on when you save it. Scripts run inside Krunker (the same format as Crankshaft-style userscripts).</p>
   <div class="card"><h2>Editor</h2><p>Leave the name empty to take it from the <span class="kbd">// @name</span> line.</p>
    <div class="edrow"><input type="text" id="seName" placeholder="Script name" maxlength="80"><label><input type="checkbox" id="seReload" checked> Reload the open game after saving</label></div>
    <textarea class="code" id="seCode" spellcheck="false" placeholder="// ==UserScript==&#10;// @name        My script&#10;// @author      Me&#10;// ==/UserScript==&#10;&#10;console.log('Hello from KRH Client');"></textarea>
    <div class="row"><button class="btn" id="seSave">Save and switch on</button><button class="btn ghost" id="seNew">New script</button></div></div>
   <div class="card"><h2>Your scripts</h2><div class="row"><button class="btn ghost" id="sAdd">+ Add .js file</button><button class="btn ghost" id="sFolder">Open folder</button></div><div class="list" id="sList"></div></div>
  </section>
  <section id="p-css" hidden>
   <h1>Custom CSS</h1><p class="sub">Write CSS here and see it in the open game while you type. Every file has its own switch and they stack in name order on top of your theme.</p>
   <div class="card"><h2>Editor</h2>
    <div class="edrow"><input type="text" id="ceName" placeholder="File name, for example my-hud.css" maxlength="80"><label><input type="checkbox" id="ceLive" checked> Apply while typing</label></div>
    <textarea class="code" id="ceCode" spellcheck="false" placeholder="/* Your CSS */&#10;#crosshair { opacity: .8; }"></textarea>
    <div class="row"><button class="btn" id="ceSave">Save</button><button class="btn ghost" id="ceNew">New file</button></div></div>
   <div class="card"><h2>Your CSS files</h2><div class="row"><button class="btn ghost" id="cAdd">+ Add .css file</button><button class="btn ghost" id="cFolder">Open folder</button></div><div class="list" id="cList"></div></div>
  </section>
  <section id="p-swapper" hidden>
   <h1>Resource Swapper</h1><p class="sub">Replace Krunker textures, sounds and models with your own files.</p>
   <div class="card"><h2>Swapper folder</h2><p>Put files here using the same paths as Krunker's own assets (for example sound/ambient_1.mp3). The game rescans it on every refresh.</p>
    <div class="row"><button class="btn" id="wFolder">Open swapper folder</button></div><p id="wPath" style="margin:10px 0 0"></p></div>
   <div class="card"><h2>Turn the swapper on or off</h2><p>It is in Settings &gt; Swapper.</p><button class="btn ghost" data-go="settings">Open settings</button></div>
  </section>
  <section id="p-live" hidden>
   <h1>Live Data</h1><p class="sub">Look up players, clans, Turf Wars, leaderboards and the item market without leaving the client. Data comes straight from Krunker's public game API (documented by the krapio project) and is cached for a minute.</p>
   <div class="card"><div class="row" id="lvTabs"><button class="btn" data-lt="player">Player</button><button class="btn ghost" data-lt="clan">Clan</button><button class="btn ghost" data-lt="turf">Turf Wars</button><button class="btn ghost" data-lt="board">Leaderboards</button><button class="btn ghost" data-lt="market">Market</button></div></div>
   <div class="card" id="lv-player"><div class="row"><input type="text" id="lvPName" placeholder="Player name" maxlength="32" autocomplete="off" spellcheck="false"><button class="btn" id="lvPGo">Look up</button></div><div id="lvPOut" style="margin-top:12px"></div></div>
   <div class="card" id="lv-clan" hidden><div class="row"><input type="text" id="lvCName" placeholder="Clan name" maxlength="32" autocomplete="off" spellcheck="false"><button class="btn" id="lvCGo">Look up</button></div><div id="lvCOut" style="margin-top:12px"></div></div>
   <div class="card" id="lv-turf" hidden><div class="row"><button class="btn" id="lvTGo">Refresh</button></div><div id="lvTOut" style="margin-top:12px"></div></div>
   <div class="card" id="lv-board" hidden><div class="row"><select id="lvBType"><option value="player_score">Players: score</option><option value="player_kills">Players: kills</option><option value="player_wins">Players: wins</option><option value="player_nukes">Players: nukes</option><option value="player_timeplayed">Players: time played</option><option value="player_funds">Players: kr</option><option value="player_skinvalue">Players: skin value</option><option value="player_followed">Players: followers</option><option value="player_ranked_matches">Players: ranked matches</option><option value="clans_score">Clans: score</option><option value="clans_members">Clans: members</option></select><button class="btn" id="lvBGo">Show top 100</button></div><div id="lvBOut" style="margin-top:12px"></div></div>
   <div class="card" id="lv-market" hidden><p>Search the item market by name. Skins are listed by their index number (the game does not give names to this API); click a row for the price analysis of the last 30 days.</p><div class="row" style="margin-top:8px"><input type="text" id="lvMTerm" placeholder="Search term, for example Katana (leave empty for everything)" maxlength="40" autocomplete="off" spellcheck="false"><button class="btn" id="lvMGo">Search</button></div><div id="lvMOut" style="margin-top:12px"></div><div id="lvMDetail" style="margin-top:12px"></div></div>
  </section>
  <section id="p-servers" hidden>
   <h1>Servers</h1><p class="sub">Your ping to every Krunker region. Star the ones you want and let the matchmaker use only those.</p>
   <div class="card"><div class="row"><button class="btn" id="svRefresh">Measure again</button><button class="btn ghost" id="svUse">Use my starred regions in the matchmaker</button><button class="btn ghost" id="svAll">Matchmaker: all regions</button></div>
    <p id="svNote" style="margin:10px 0"></p><table><thead><tr><th></th><th>Region</th><th>Ping</th></tr></thead><tbody id="svBody"></tbody></table></div>
  </section>
  <section id="p-history" hidden>
   <h1>History</h1><p class="sub">Your recent sessions, saved on this PC.</p>
   <div class="card"><h2>All time</h2><div class="stat" id="hiTotal"></div></div>
   <div class="card"><h2>Sessions</h2><table><thead><tr><th>Date</th><th>Kills / Deaths</th><th>K/D</th><th>Time</th><th>Matches</th><th>Best streak</th><th>Most played</th></tr></thead><tbody id="hiBody"></tbody></table><div class="empty" id="hiEmpty" hidden>No sessions yet. Play a match and it will show up here.</div></div>
  </section>
  <section id="p-profiles" hidden>
   <h1>Profiles</h1><p class="sub">Snapshots of your Krunker settings (sensitivity, controls, graphics) you can load with one click. They are the same profiles as Settings &gt; General &gt; Settings Profiles. The game has to be open to save or load one.</p>
   <div class="card"><div class="row"><input type="text" id="pName" placeholder="Profile name, for example Ranked" maxlength="60"><button class="btn" id="pSave">Save current settings</button></div><div class="list" id="pList"></div></div>
   <div class="card"><h2>Low-End preset</h2><p>Turns on a set of lighter settings for weak PCs and restarts the client.</p><button class="btn ghost" id="pLow">Apply Low-End preset and restart</button></div>
  </section>
  <section id="p-keybinds" hidden>
   <h1>Keybinds</h1><p class="sub">Every KRH Client hotkey in one list. Change them in Settings &gt; General &gt; Hotkeys.</p>
   <div class="card"><table><tbody id="kbBody"></tbody></table><div class="row" style="margin-top:12px"><button class="btn ghost" data-go="settings">Open settings</button></div></div>
  </section>
  <section id="p-news" hidden>
   <h1>Krunker news</h1><p class="sub">The latest Krunker updates and events from the KRH website.</p>
   <div class="card"><div class="row"><button class="btn" id="newsRefresh">Refresh</button><button class="btn ghost" id="newsOpen">Open News on KRH</button></div><p id="newsStatus" style="margin:10px 0 0"></p></div>
   <div id="newsList"></div>
  </section>
  <section id="p-diag" hidden>
   <h1>Diagnostics</h1><p class="sub">Everything useful for a bug report in one paste: versions, your PC, the settings that matter for performance and the end of the log. E-mail addresses and tokens are hidden.</p>
   <div class="card"><h2>Performance doctor</h2><p>Low FPS or lag? One click checks the Electron build, your FPS and GPU settings, display scaling and which processes use CPU. Run it while the game is open for the real picture.</p><div class="row"><button class="btn" id="drRun">Run check</button><button class="btn ghost" id="drCopy" hidden>Copy report</button></div><p class="drsum" id="drSum"></p><div id="drList"></div></div>
   <div class="card"><div class="row"><button class="btn" id="dgCopy">Copy report</button><button class="btn ghost" id="dgRefresh">Refresh</button><button class="btn ghost" id="dgLogs">Open logs folder</button></div><pre class="diag" id="dgText">Loading...</pre></div>
  </section>
  <section id="p-logs" hidden>
   <h1>Logs</h1><p class="sub">The client log of one day, so you do not have to open the text file. Pick a topic, search for a word, copy what you see. E-mail addresses and tokens are hidden.</p>
   <div class="card"><div class="row"><select id="lvFilter"></select><select id="lvDay"></select><input id="lvQuery" type="text" maxlength="80" placeholder="search text"><button class="btn" id="lvRefresh">Refresh</button><button class="btn ghost" id="lvCopy">Copy</button><button class="btn ghost" id="lvOpen">Open logs folder</button></div><p id="lvInfo" style="margin:10px 0 0;opacity:.7"></p><pre class="diag" id="lvText">Loading...</pre></div>
  </section>
  <section id="p-updates" hidden>
   <h1>What's new</h1><p class="sub" id="upSub"></p>
   <div class="card"><div class="row"><button class="btn" id="upCheck">Check for updates</button><button class="btn ghost" data-link="https://github.com/KNLZVXAura/Krunker-Resource-Hub-Client/releases">Open releases</button><button class="btn ghost" id="upCopy" hidden>Copy report</button></div><p id="upNote" style="margin:10px 0 0"></p><pre id="upReport" hidden style="margin:10px 0 0;white-space:pre-wrap;font-size:12px;line-height:1.5;opacity:.9"></pre></div>
   <div class="card"><h2>Release notes for your version</h2><div class="md" id="upNotes">Loading...</div></div>
  </section>
  <section id="p-settings" hidden>
   <h1>Client Settings</h1><p class="sub">The same options as Settings &gt; Client in the game. Everything here is saved at once. Type in the search box (or press Ctrl+F) to find a setting in any category.</p>
   <div class="note"><span>Options that act on the page you are playing reach an open game after it reloads.</span><span class="row"><button class="btn ghost" id="reloadGame">Reload game now</button><button class="btn ghost" id="restartBtn2">Restart client</button></span></div>
   <div class="ssearch"><span class="material-icons">search</span><input type="text" id="settSearchDash" placeholder="Search settings, e.g. fps, crosshair, sound, hotkey" autocomplete="off" spellcheck="false"><button class="ssx" id="settSearchClear" title="Clear search" hidden>&times;</button><span class="ssc" id="settSearchCount"></span></div>
   <p class="snone" id="settNone" hidden>No setting matches that. Try a shorter or different word.</p>
   <div id="settHolder"></div>
  </section>
  <section id="p-themes" hidden>
   <h1>Themes</h1><p class="sub">How this window looks. Pick a preset, then add your own picture if you like.</p>
   <div class="card"><h2>Brightness</h2><p>Too dark or too bright? Set it the way you like. Everything is saved at once.</p>
    <div class="look-row"><label for="thBright">Brightness</label><input type="range" id="thBright" min="0" max="100" value="62"><output id="thBrightV">62</output></div>
    <div class="look-row"><label for="thGlass">Panel solidness</label><input type="range" id="thGlass" min="0" max="100" value="42"><output id="thGlassV">42</output></div>
    <div class="row" style="margin-top:8px"><button class="chip" data-look="bright">Bright</button><button class="chip" data-look="balanced">Balanced (default)</button><button class="chip" data-look="dark">Dark</button></div></div>
   <div class="card"><h2>Font</h2><p>Choose how the dashboard text looks: font family, color and size.</p>
    <div class="look-row"><label for="lgFont">Font Family</label><select id="lgFont"></select></div>
    <div class="look-row" id="lgCustomRow" hidden><label for="lgCustom">Font name</label><input type="text" id="lgCustom" maxlength="40" placeholder="Any font installed on this PC, e.g. Segoe Print"></div>
    <div class="look-row"><label for="lgColor">Font Color</label><input type="color" id="lgColor" value="#f7f4ff"><label style="width:auto"><input type="checkbox" id="lgColorDef" checked> Default</label></div>
    <div class="look-row"><label for="lgSize">Text Size</label><input type="range" id="lgSize" min="80" max="150" step="5" value="100"><output id="lgSizeV">100%</output></div>
    <div class="row" style="margin-top:8px"><button class="chip" id="lgReset">Reset to default</button></div></div>
   <div class="card"><h2>Effects</h2><p>Glass blur and motion look nice but use graphics power. Switch them off if the dashboard feels slow on your PC.</p><div class="edrow"><label><input type="checkbox" id="thFx" checked> Glass blur</label><label><input type="checkbox" id="thAnim" checked> Animations</label></div></div>
   <div class="card"><h2>Theme</h2><p>Colours and glass effect of the whole dashboard.</p><div class="tgrid" id="thGrid"></div></div>
   <div class="card"><h2>Custom image</h2><p>Use your own picture behind the theme: add one from your computer, pick one from your backgrounds folder, or use a link. Choose Default to go back to the theme's own look.</p>
    <div class="row"><select id="bMode"><option value="default">Default</option><option value="file">An image from my folder</option><option value="random">Random from my folder</option><option value="url">An image link</option></select>
     <select id="bFile"></select><input type="text" id="bUrl" placeholder="https://example.com/image.jpg"></div>
    <div class="row" style="margin-top:10px"><label for="bDim" class="meta">Darken picture</label><input type="range" id="bDim" min="0" max="90" value="35"><button class="btn ghost" id="bAdd">Add image...</button><button class="btn ghost" id="bFolder">Open backgrounds folder</button></div></div>
  </section>
  <section id="p-look" hidden>
   <h1>Maintenance</h1><p class="sub">Cache, logs and clean-up tools.</p>
   <div class="card"><h2>Cache</h2><p id="chInfo">Measuring...</p><div class="row"><label for="chLimit" class="meta">Clear it automatically when it is bigger than</label><select id="chLimit"><option value="0">Never</option><option value="500">500 MB</option><option value="1000">1 GB</option><option value="2000">2 GB</option></select><button class="btn ghost" id="chNow">Clear now</button></div></div>
   <div class="card"><h2>Logs</h2><p>Where KRH Client writes what it is doing (useful for bug reports).</p><button class="btn ghost" id="lgOpen">Open logs folder</button></div>
   <div class="card"><h2>Backup</h2><p>Saves your client settings, userscripts, custom CSS, built-in script options and statistics in one file. Saved accounts and the swapper folder are not included. Restore it on this or another computer.</p><div class="row"><button class="btn ghost" id="bkMake">Create backup...</button><button class="btn ghost" id="bkRestore">Restore backup...</button></div><p id="bkInfo" class="meta"></p></div>
   <div class="card"><h2>Clear cache</h2><p>Deletes Krunker's cached files only. You stay signed in and keep your game settings.</p><button class="btn ghost" id="clCache">Clear cache</button></div>
   <div class="card"><h2>Clear Krunker data</h2><p>Deletes cookies, local storage and cache saved by the game in this client. You will be signed out and Krunker's own settings go back to default. KRH Client settings are kept.</p><button class="btn bad" id="clData">Clear Krunker data...</button></div>
  </section>
 </main>
 </div>
 </div>
</div>
<div class="toast" id="toast"></div>
`;

const JS = `
const call = (c, ...a) => window.krhDash.call('dash:' + c, ...a);
const $ = (id) => document.getElementById(id);
let toastT = 0;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function show(p) {
  document.querySelectorAll('main section').forEach((s) => { s.hidden = s.id !== 'p-' + p; if (!s.hidden) stagger(s); });
  document.querySelectorAll('.grid .tile, .tgrid .theme-tile').forEach((t, i) => t.style.setProperty('--i', String(i)));
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  if (p === 'scripts') loadScripts(); if (p === 'css') loadCss(); if (p === 'themes') { loadThemes(); loadBg(); } if (p === 'look') loadCache();
  if (p === 'home') loadGames(); if (p === 'servers') loadServers(false); if (p === 'history') loadHistory();
  if (p === 'profiles') loadProfiles(); if (p === 'keybinds') loadKeybinds(); if (p === 'diag') loadDiag(); if (p === 'logs') loadLogs(); if (p === 'news') loadNews(false); if (p === 'home') loadGuard(); if (p === 'updates') loadUpdates();
  if (p === 'settings') document.dispatchEvent(new Event('krh-dash-settings'));
}
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.p)));
const doRestart = () => { if (confirm('Restart KRH Client now? An open game will close.')) call('restart-client'); };
$('restartBtn').onclick = doRestart; if ($('restartBtn2')) $('restartBtn2').onclick = doRestart;
$('reloadGame').onclick = async () => { const r = await call('reload-game'); toast(r && r.ok ? 'Game reloaded' : 'The game is not open'); };
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F') && !$('p-settings').hidden) { e.preventDefault(); const si = $('settSearchDash'); si.focus(); si.select(); }
});
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]'); if (g) show(g.dataset.go);
  const o = e.target.closest('[data-open]'); if (o) call('open', o.dataset.open).then((r) => { if (r && r.error) toast(r.error); });
  const l = e.target.closest('[data-link]'); if (l) call('link', l.dataset.link);
});
function itemRow(f, onToggle, onDelete, meta, onEdit) {
  const row = document.createElement('div'); row.className = 'item';
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.name;
  const m = document.createElement('span'); m.className = 'meta'; m.textContent = meta || '';
  const sw = document.createElement('div'); sw.className = 'sw' + (f.enabled ? ' on' : ''); sw.title = 'On / off'; sw.addEventListener('click', onToggle);
  const x = document.createElement('button'); x.className = 'x'; x.textContent = '\\u2715'; x.title = 'Delete'; x.addEventListener('click', onDelete);
  row.append(nm, m);
  if (onEdit) { const ed = document.createElement('button'); ed.className = 'ed'; ed.textContent = 'Edit'; ed.title = 'Open in the editor'; ed.addEventListener('click', onEdit); row.append(ed); }
  row.append(sw, x); return row;
}
function fill(list, rows, emptyText) {
  list.replaceChildren(); if (!rows.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = emptyText; list.append(e); return; }
  rows.forEach((r, i) => { r.style.setProperty('--i', String(Math.min(i, 10))); list.append(r); });
}
async function loadScripts() {
  const r = await call('scripts-list');
  if (r.disabled) { fill($('sList'), [], 'Userscripts are turned off. Turn them on in Client Settings > Userscripts and restart the client.'); return; }
  fill($('sList'), r.files.map((f) => itemRow(f, async () => { await call('scripts-toggle', f.name); loadScripts(); }, async () => { if (confirm('Delete ' + f.name + '?')) { await call('scripts-delete', f.name); loadScripts(); } }, '', () => editScript(f.name))), 'No scripts yet. Write one above or add a .js file.');
}
async function editScript(name) {
  const r = await call('script-read', name); if (r.error) { toast(r.error); return; }
  $('seName').value = name; $('seCode').value = r.code; $('seCode').scrollIntoView({ block: 'nearest' });
}
$('seSave').onclick = async () => {
  const r = await call('script-save', { name: $('seName').value, code: $('seCode').value, reload: $('seReload').checked });
  if (r.error) { toast(r.error); return; }
  $('seName').value = r.name; toast(r.reloaded ? 'Saved, switched on, game reloaded' : 'Saved and switched on (runs when the game loads)'); loadScripts();
};
$('seNew').onclick = () => { $('seName').value = ''; $('seCode').value = ''; };
async function loadCss() {
  const r = await call('css-list');
  fill($('cList'), r.files.map((f) => itemRow(f, async () => { await call('css-toggle', f.name); loadCss(); }, async () => { if (confirm('Delete ' + f.name + '?')) { await call('css-delete', f.name); loadCss(); } }, Math.max(1, Math.round(f.size / 1024)) + ' KB', () => editCss(f.name))), 'No CSS files yet. Write some above or add a .css file.');
}
async function editCss(name) {
  const r = await call('css-read', name); if (r.error) { toast(r.error); return; }
  $('ceName').value = name; $('ceCode').value = r.css; $('ceCode').scrollIntoView({ block: 'nearest' });
}
async function saveCssNow(quiet) {
  const name = $('ceName').value.trim();
  if (!name) { if (!quiet) toast('Give the file a name first'); return false; }
  const r = await call('css-save', { name: name, css: $('ceCode').value });
  if (r.error) { if (!quiet) toast(r.error); return false; }
  $('ceName').value = r.name; if (!quiet) { toast('Saved'); } loadCss(); return true;
}
$('ceSave').onclick = () => saveCssNow(false);
$('ceNew').onclick = () => { $('ceName').value = ''; $('ceCode').value = ''; };
let ceT = 0;
$('ceCode').addEventListener('input', () => { if (!$('ceLive').checked || !$('ceName').value.trim()) return; clearTimeout(ceT); ceT = setTimeout(() => saveCssNow(true), 500); });
for (const id of ['seCode', 'ceCode']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const a = t.selectionStart; t.value = t.value.slice(0, a) + '  ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = a + 2; t.dispatchEvent(new Event('input')); } });
$('sAdd').onclick = async () => { const r = await call('scripts-add'); if (r && r.error) toast(r.error); else if (r && r.name) toast('Added ' + r.name); loadScripts(); };
$('cAdd').onclick = async () => { const r = await call('css-add'); if (r && r.error) toast(r.error); else if (r && r.name) toast('Added ' + r.name); loadCss(); };
$('sFolder').onclick = () => call('folder', 'scripts'); $('cFolder').onclick = () => call('folder', 'css');
$('wFolder').onclick = () => call('folder', 'swapper'); $('bFolder').onclick = () => call('folder', 'backgrounds');

let prefs = { mode: 'default', file: '', url: '', dim: 8, theme: 'aurora', fx: true, bright: 62, glass: 42, anim: true, font: '', fontCustom: '', color: '', size: 100 };
async function applyBg() {
  const r = await call('bg'); const bg = $('bg');
  bg.style.backgroundImage = r.image ? 'url("' + r.image + '")' : '';
  $('dim').style.opacity = (r.image ? prefs.dim / 100 : 0.0);
}
async function loadBg() {
  const r = await call('bg-prefs'); prefs = r.prefs;
  $('bMode').value = prefs.mode; $('bUrl').value = prefs.url; $('bDim').value = prefs.dim;
  const sel = $('bFile'); sel.replaceChildren();
  r.files.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.append(o); });
  if (prefs.file && r.files.includes(prefs.file)) sel.value = prefs.file;
  syncBgFields();
}
function syncBgFields() { const m = $('bMode').value; $('bFile').style.display = m === 'file' ? '' : 'none'; $('bUrl').style.display = m === 'url' ? '' : 'none'; }
async function saveBg() {
  prefs = { mode: $('bMode').value, file: $('bFile').value || '', url: $('bUrl').value.trim(), dim: Number($('bDim').value), theme: prefs.theme, fx: prefs.fx, bright: prefs.bright, glass: prefs.glass, anim: prefs.anim, font: prefs.font, fontCustom: prefs.fontCustom, color: prefs.color, size: prefs.size };
  syncBgFields(); await call('bg-save', prefs); applyBg();
}
['bMode', 'bFile'].forEach((id) => $(id).addEventListener('change', saveBg));
$('bUrl').addEventListener('change', saveBg); $('bDim').addEventListener('input', saveBg);
$('bAdd').onclick = async () => { const r = await call('bg-add'); if (r && r.error) toast(r.error); else if (r && r.name) { toast('Added ' + r.name); $('bMode').value = 'file'; await loadBg(); $('bFile').value = r.name; saveBg(); } };
$('clCache').onclick = async () => { await call('clear-cache'); toast('Cache cleared'); };
$('bkMake').onclick = async () => {
  const r = await call('backup-create');
  if (r && r.ok) { $('bkInfo').textContent = 'Saved ' + r.files + ' files and ' + r.settings + ' settings groups to ' + r.path; toast('Backup saved'); }
  else if (r && !r.canceled) toast('Backup failed: ' + (r.error || 'unknown error'));
};
$('bkRestore').onclick = async () => {
  const r = await call('backup-restore');
  if (r && r.ok) { $('bkInfo').textContent = 'Restored ' + r.files + ' files and ' + r.settings + ' settings groups. Restarting...'; toast('Backup restored, restarting'); setTimeout(() => call('restart-client'), 1400); }
  else if (r && !r.canceled) toast('Restore failed: ' + (r.error || 'unknown error'));
};
$('clData').onclick = async () => { const r = await call('clear-data'); if (r && r.cleared) toast('Krunker data cleared'); };

const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 90) return 'just now'; const m = s / 60; if (m < 90) return Math.round(m) + ' min ago'; const h = m / 60; if (h < 36) return Math.round(h) + ' h ago'; return Math.round(h / 24) + ' days ago'; };
const REGIONS = { SV: 'Silicon Valley', TOK: 'Tokyo', FRA: 'Frankfurt', MBI: 'Mumbai', SYD: 'Sydney', SIN: 'Singapore', DAL: 'Dallas', BHN: 'Bahrain', BRZ: 'Brazil', NY: 'New York' };

async function loadGames() {
  const r = await call('games'); const last = $('gLast'); last.replaceChildren();
  // Recent games: the tab name of the game (for example "Sandstorm - Krunker") and its link. Both open the game.
  const go = async (url) => { const x = await call('game-join', url); if (x.error) toast(x.error); };
  (r.recent || []).forEach((g) => {
    const row = el('div', 'item');
    const nm = el('button', 'btn ghost', g.title || g.url.split('=')[1]); nm.title = 'Join this game'; nm.onclick = () => go(g.url);
    const lk = el('button', 'btn ghost', g.url.replace(/^https?:\\/\\//, '')); lk.title = 'Join this game'; lk.style.opacity = '.8'; lk.onclick = () => go(g.url);
    row.append(nm, lk, el('span', 'meta', ago(g.at))); last.append(row);
  });
  if (!(r.recent || []).length) last.append(el('div', 'empty', 'No game yet. The ones you join are remembered here, newest first.'));
  $('gClear').hidden = !(r.recent || []).length;
  const favs = $('gFavs'); favs.replaceChildren();
  r.favorites.forEach((f) => { const row = el('div', 'item'); const nm = el('span', 'nm', f.name); const j = el('button', 'btn ghost', 'Join'); j.onclick = async () => { const x = await call('game-join', f.url); if (x.error) toast(x.error); };
    const x = el('button', 'x', '\u2715'); x.title = 'Remove'; x.onclick = async () => { await call('game-fav-remove', f.url); loadGames(); }; row.append(nm, j, x); favs.append(row); });
  $('gSave').disabled = !r.current;
}
async function joinByLink() {
  const v = $('gJoinUrl').value.trim();
  if (!v) { toast('Paste a game link first'); return; }
  const r = await call('game-join', v);
  if (r && r.error) { toast(r.error); return; }
  toast('Opening Krunker...'); $('gJoinUrl').value = '';
}
$('gJoinGo').onclick = joinByLink;
$('gClear').onclick = async () => { await call('games-clear'); loadGames(); };
$('gJoinUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinByLink(); } });
$('gSave').onclick = async () => { const r = await call('game-fav-add', $('gName').value); if (r.error) toast(r.error); else { $('gName').value = ''; toast('Saved'); } loadGames(); };


// ── Live Data (Krunker public game API) ──
const live = async (kind, arg) => { const r = await call('live', kind, arg || {}); if (!r || !r.ok) throw new Error((r && r.error) || 'Request failed'); return r.data; };
const nf = (n) => (typeof n === 'number' ? n.toLocaleString() : String(n == null ? '-' : n));
const lvBusy = (box) => { box.replaceChildren(el('p', '', 'Loading...')); };
const lvFail = (box, e) => { box.replaceChildren(el('p', 'ping-bad', e && e.message ? e.message : 'Something went wrong')); };
const lvTable = (box, heads, rows, onRow) => {
  const t = document.createElement('table'); const hr = document.createElement('tr'); heads.forEach((h) => hr.append(el('th', '', h)));
  const th = document.createElement('thead'); th.append(hr); const tb = document.createElement('tbody');
  rows.forEach((cells, i) => { const tr = document.createElement('tr'); cells.forEach((c) => tr.append(el('td', '', String(c)))); if (onRow) { tr.style.cursor = 'pointer'; tr.onclick = () => onRow(i); } tb.append(tr); });
  t.append(th, tb); box.replaceChildren(t);
};
const lvTabs = ['player', 'clan', 'turf', 'board', 'market'];
document.querySelectorAll('#lvTabs button').forEach((b) => { b.onclick = () => {
  lvTabs.forEach((t) => { $('lv-' + t).hidden = t !== b.dataset.lt; });
  document.querySelectorAll('#lvTabs button').forEach((x) => x.classList.toggle('ghost', x !== b));
  if (b.dataset.lt === 'turf') $('lvTGo').click();
}; });
const kdr = (k, d) => (d ? (k / d).toFixed(2) : String(k));
const hoursOf = (s) => (s / 3600).toFixed(1) + ' h';

async function lvPlayer(nm) {
  const box = $('lvPOut'); lvBusy(box);
  try {
    const p = await live('player', { name: nm }); const st = p.player_stats || {};
    const rows = [['Name', p.player_name + (p.player_clan ? ' [' + p.player_clan + ']' : '')], ['Score', nf(p.player_score)], ['Kills / Deaths', nf(p.player_kills) + ' / ' + nf(p.player_deaths) + '  (K/D ' + kdr(p.player_kills, p.player_deaths) + ')'], ['Wins / Games', nf(p.player_wins) + ' / ' + nf(p.player_games_played)], ['Time played', hoursOf(p.player_timeplayed || 0)], ['Nukes', nf(st.n)], ['Headshots / Wallbangs', nf(st.hs) + ' / ' + nf(st.wb)], ['Accuracy', st.s ? (100 * st.h / st.s).toFixed(1) + ' %' : '-'], ['Melee / Thrown kills', nf(st.mk) + ' / ' + nf(st.tmk)], ['Assists', nf(st.ast)], ['KR', nf(p.player_funds)], ['Skin value', nf(p.player_skinvalue)], ['Followers / Following', nf(p.player_followed) + ' / ' + nf(p.player_following)], ['Joined', p.player_datenew || '-']];
    lvTable(box, ['Stat', 'Value'], rows);
  } catch (e) {
    if (e.message !== 'Not found') return lvFail(box, e);
    try { const list = await live('player-search', { name: nm }); if (!list.results || !list.results.length) return lvFail(box, new Error('No player found')); lvTable(box, ['Did you mean', 'Score'], list.results.map((r) => [r.player_name, nf(r.player_score)]), (i) => { $('lvPName').value = list.results[i].player_name; lvPlayer(list.results[i].player_name); }); } catch (e2) { lvFail(box, e2); }
  }
}
$('lvPGo').onclick = () => { const v = $('lvPName').value.trim(); if (v) lvPlayer(v); };
$('lvPName').onkeydown = (e) => { if (e.key === 'Enter') $('lvPGo').click(); };

async function lvClan(nm) {
  const box = $('lvCOut'); lvBusy(box);
  try {
    const c = await live('clan', { name: nm }); const m = (c.members || []).slice().sort((a, b) => b.s - a.s); const roles = ['Recruit', 'Soldier', 'Captain', 'Commander'];
    const head = el('p', '', c.clan_name + '  |  rank #' + nf(c.clan_rank) + '  |  score ' + nf(c.clan_score) + '  |  ' + m.length + ' members  |  leader ' + c.creator_name);
    const holder = document.createElement('div'); lvTable(holder, ['#', 'Member', 'Role', 'Score', 'Last 7 days'], m.map((x, i) => [i + 1, x.p, roles[x.r] || '-', nf(x.s), nf(x.s7)]));
    box.replaceChildren(head, holder);
  } catch (e) { lvFail(box, e); }
}
$('lvCGo').onclick = () => { const v = $('lvCName').value.trim(); if (v) lvClan(v); };
$('lvCName').onkeydown = (e) => { if (e.key === 'Enter') $('lvCGo').click(); };

$('lvTGo').onclick = async () => {
  const box = $('lvTOut'); lvBusy(box);
  try {
    const st = await live('turf-status'); const list = Array.isArray(st) ? st : [st]; box.replaceChildren();
    list.forEach((m) => { const h = el('h2', '', m.map_name + ' - held by ' + (m.clan_name || 'nobody')); const meta = el('p', '', 'Kills today: ' + nf(m.total_kills_today) + '  |  guaranteed reward ' + nf(m.guaranteed_reward) + '  |  estimated ' + nf(m.estimated_reward));
      const t = document.createElement('div'); lvTable(t, ['#', 'Clan', 'Kills', 'Deaths'], (m.leaderboard || []).map((r) => [r.position, r.clan_name, nf(r.kills), nf(r.deaths)])); t.style.marginBottom = '14px'; box.append(h, meta, t); });
  } catch (e) { lvFail(box, e); }
};

$('lvBGo').onclick = async () => {
  const box = $('lvBOut'); lvBusy(box); const v = $('lvBType').value;
  try {
    if (v.startsWith('clans_')) { const rows = await live('board-clans', { sort: v.slice(6) }); lvTable(box, ['#', 'Clan', 'Score', 'Members'], rows.map((r) => [r.position, r.clan_name, nf(r.clan_score), nf(r.member_count)]), (i) => { show('live'); document.querySelector('#lvTabs [data-lt=clan]').click(); $('lvCName').value = rows[i].clan_name; lvClan(rows[i].clan_name); }); }
    else { const rows = await live('board-players', { type: v }); const time = v === 'player_timeplayed'; lvTable(box, ['#', 'Player', 'Clan', 'Value'], rows.map((r) => [r.position, r.player_name, r.player_clan || '', time ? hoursOf(r.value) : nf(r.value)]), (i) => { document.querySelector('#lvTabs [data-lt=player]').click(); $('lvPName').value = rows[i].player_name; lvPlayer(rows[i].player_name); }); }
  } catch (e) { lvFail(box, e); }
};

function lvAnalyse(skin, info, sales) {
  const box = $('lvMDetail'); box.replaceChildren();
  const rows = (sales || []).slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  const avg = (list) => { const kr = list.reduce((s, r) => s + r.f, 0); const n = list.reduce((s, r) => s + r.t, 0); return n ? kr / n : 0; };
  const recent = rows.slice(-7); const a7 = avg(recent); const a30 = avg(rows); const sold30 = rows.reduce((s, r) => s + r.t, 0);
  const lines = ['Skin #' + skin, 'Lowest ask: ' + (info.low ? nf(info.low) + ' kr' : 'nothing listed') + '  |  highest ask: ' + (info.high ? nf(info.high) + ' kr' : '-') + '  |  in circulation: ' + nf(info.inC)];
  if (rows.length) {
    lines.push('Average sale price: last 7 sale days ' + nf(Math.round(a7)) + ' kr, last 30 days ' + nf(Math.round(a30)) + ' kr  |  ' + nf(sold30) + ' sold in 30 days');
    if (a30) { const tr = (a7 - a30) / a30 * 100; lines.push('Trend: ' + (tr >= 0 ? '+' : '') + tr.toFixed(1) + ' % compared to the 30 day average (' + (Math.abs(tr) < 3 ? 'flat' : tr > 0 ? 'rising' : 'falling') + ')'); }
    if (info.low && a7) { const d = (info.low - a7) / a7 * 100; lines.push('The lowest ask is ' + Math.abs(d).toFixed(1) + ' % ' + (d <= 0 ? 'below' : 'above') + ' the recent average sale price' + (d <= -10 ? ' - looks cheap.' : d >= 10 ? ' - looks overpriced.' : ' - looks fair.')); }
    const max = Math.max.apply(null, rows.map((r) => (r.t ? r.f / r.t : 0)));
    const bars = el('div', ''); bars.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:70px;margin:10px 0';
    rows.forEach((r) => { const v = r.t ? r.f / r.t : 0; const b = document.createElement('div'); b.title = r.d + ': ' + nf(Math.round(v)) + ' kr x ' + r.t; b.style.cssText = 'flex:1;min-width:3px;border-radius:3px 3px 0 0;background:var(--acc);height:' + Math.max(3, max ? v / max * 100 : 3) + '%'; bars.append(b); });
    box.append(bars);
  } else lines.push('No sales in the last 30 days. Prices from so few trades are not reliable.');
  lines.forEach((l) => box.append(el('p', '', l)));
  box.append(el('p', '', 'Market data needs time to say anything useful. Do not treat it as financial advice.'));
}

async function lvMarket() {
  const box = $('lvMOut'); lvBusy(box); $('lvMDetail').replaceChildren();
  try {
    const r = await live('market-stats', { term: $('lvMTerm').value }); const st = r.stats || [];
    if (!st.length) return box.replaceChildren(el('p', '', 'Nothing found'));
    lvTable(box, ['Skin', 'Lowest ask', 'Highest ask', 'In circulation', 'On sale'], st.map((x) => ['#' + x.ski, x.low ? nf(x.low) : '-', x.high ? nf(x.high) : '-', nf(x.inC), nf(x.onS)]), async (i) => {
      const d = $('lvMDetail'); lvBusy(d);
      try { const [info, sales] = await Promise.all([live('market-info', { id: st[i].ski }), live('market-sales', { id: st[i].ski })]); lvAnalyse(st[i].ski, info, sales); } catch (e) { lvFail(d, e); }
    });
  } catch (e) { lvFail(box, e); }
}
$('lvMGo').onclick = lvMarket;
$('lvMTerm').onkeydown = (e) => { if (e.key === 'Enter') lvMarket(); };

async function loadServers(force) {
  $('svBody').replaceChildren(); $('svNote').textContent = force ? 'Measuring...' : 'Loading...';
  const r = await call('servers', force === true); const body = $('svBody');
  if (!r.rows.length) { $('svNote').textContent = 'No ping results yet (the pings use your system ping command).'; return; }
  r.rows.forEach((row) => {
    const tr = document.createElement('tr'); const s = el('button', 'star' + (row.fav ? ' on' : ''), row.fav ? '\u2605' : '\u2606'); s.onclick = async () => { await call('server-fav', row.code); loadServers(false); };
    const c0 = document.createElement('td'); c0.append(s); const c1 = el('td', '', (REGIONS[row.code] || row.code) + ' (' + row.code + ')');
    const c2 = el('td', row.ms < 60 ? 'ping-good' : row.ms < 120 ? 'ping-mid' : 'ping-bad', row.ms + ' ms'); tr.append(c0, c1, c2); body.append(tr);
  });
  $('svNote').textContent = r.matchmakerRegions.length ? 'The matchmaker only looks in ' + r.matchmakerRegions.length + ' region(s) you chose.' : 'The matchmaker looks in all regions.';
}
$('svRefresh').onclick = () => loadServers(true);
$('svUse').onclick = async () => { const r = await call('server-use-favs', false); toast(r.regions.length ? 'The matchmaker now uses your starred regions' : 'Star at least one region first'); loadServers(false); };
$('svAll').onclick = async () => { await call('server-use-favs', true); toast('The matchmaker uses all regions again'); loadServers(false); };

async function loadHistory() {
  const r = await call('history'); const t = $('hiTotal'); t.replaceChildren();
  [['Sessions', r.total.sessions], ['Kills', r.total.kills], ['Deaths', r.total.deaths], ['K/D', r.total.kd], ['Time played', r.total.duration], ['Best streak', r.total.bestStreak]].forEach(([k, v]) => { const d = document.createElement('div'); const b = el('b', '', ''); countUp(b, String(v)); d.append(b, el('span', '', k)); t.append(d); });
  const body = $('hiBody'); body.replaceChildren(); const rows = (r.current ? [r.current] : []).concat(r.recent);
  $('hiEmpty').hidden = rows.length > 0;
  rows.forEach((s, i) => { const tr = document.createElement('tr'); const when = (r.current && i === 0) ? 'Now (running)' : new Date(s.start).toLocaleString();
    [when, s.kills + ' / ' + s.deaths, s.kd, s.duration, String(s.matches), String(s.bestStreak), s.topMap || '-'].forEach((x) => tr.append(el('td', '', x))); body.append(tr); });
}

async function loadProfiles() {
  const r = await call('profiles'); const list = $('pList'); list.replaceChildren();
  if (!r.names.length) list.append(el('div', 'empty', 'No profiles saved yet.'));
  r.names.forEach((n) => { const row = el('div', 'item'); const nm = el('span', 'nm', n);
    const a = el('button', 'btn', 'Load'); a.onclick = async () => { const x = await call('profile-apply', n); toast(x.error || 'Profile loaded: ' + n); };
    const d = el('button', 'x', '\u2715'); d.title = 'Delete'; d.onclick = async () => { if (confirm('Delete the profile ' + n + '?')) { await call('profile-delete', n); loadProfiles(); } };
    row.append(nm, a, d); list.append(row); });
}
$('pSave').onclick = async () => { const x = await call('profile-save', $('pName').value); if (x.error) toast(x.error); else { $('pName').value = ''; toast('Profile saved'); } loadProfiles(); };
$('pLow').onclick = () => { if (confirm('Apply the Low-End preset and restart KRH Client now? An open game will close.')) call('low-end'); };

async function loadKeybinds() {
  const r = await call('keybinds'); const b = $('kbBody'); b.replaceChildren();
  r.rows.forEach((x) => { const tr = document.createElement('tr'); if (x.label.indexOf('dashboard') >= 0) tr.className = 'hl'; const c = document.createElement('td'); c.append(el('span', 'kbd', x.combo)); tr.append(el('td', '', x.label), c); b.append(tr); });
}

var lvReady = false;
async function loadLogs() {
  if (!lvReady) {
    var info = await call('log-list');
    var f = $('lvFilter'); f.innerHTML = '';
    info.filters.forEach(function (x) { var o = document.createElement('option'); o.value = x.id; o.textContent = x.label; f.appendChild(o); });
    var d = $('lvDay'); d.innerHTML = '';
    info.files.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n.slice(9, 19) + (n === info.current ? ' (today)' : ''); d.appendChild(o); });
    if (info.current) d.value = info.current;
    lvReady = true;
  }
  $('lvText').textContent = 'Loading...';
  var r = await call('log-read', { file: $('lvDay').value, filter: $('lvFilter').value, query: $('lvQuery').value });
  $('lvText').textContent = r.error ? r.error : (r.text || '(no lines match)');
  $('lvInfo').textContent = r.error ? '' : ('Showing the last ' + r.shown + ' of ' + r.matched + ' matching lines (' + r.total + ' lines in the part of the file that was read).');
  $('lvText').scrollTop = $('lvText').scrollHeight;
}
$('lvRefresh').onclick = loadLogs; $('lvFilter').onchange = loadLogs; $('lvDay').onchange = loadLogs;
$('lvQuery').onkeydown = function (e) { if (e.key === 'Enter') loadLogs(); };
$('lvCopy').onclick = async function () { await call('copy-text', $('lvText').textContent); toast('Copied'); };
$('lvOpen').onclick = function () { call('folder', 'logs'); };
async function loadDiag() { $('dgText').textContent = 'Loading...'; const r = await call('diag'); $('dgText').textContent = r.text; }
$('dgRefresh').onclick = loadDiag; $('dgCopy').onclick = async () => { await call('diag-copy'); toast('Report copied'); }; $('dgLogs').onclick = () => call('folder', 'logs'); $('lgOpen').onclick = () => call('folder', 'logs');

async function loadUpdates() {
  const info = await call('info'); $('upSub').textContent = 'You are running KRH Client v' + info.version + '.'; $('upNotes').textContent = 'Loading...';
  const r = await call('changelog'); const box = $('upNotes');
  if (r.html) box.innerHTML = r.html; else box.textContent = 'No release notes found for this version (they are published with each release on GitHub).';
}
let upLast = '';
$('upCheck').onclick = async () => {
  $('upNote').textContent = 'Checking...'; $('upReport').hidden = true; $('upCopy').hidden = true;
  const r = await call('updates');
  $('upNote').textContent = r.available ? 'Version ' + r.latest + ' is available. It installs when you restart the client, or get it from the releases page.' : (r.latest ? 'No newer version found.' : 'The latest version could not be read.');
  upLast = r.report + (r.logTail ? '\\n\\nRecent update log lines:\\n' + r.logTail : '');
  $('upReport').textContent = upLast; $('upReport').hidden = false; $('upCopy').hidden = false;
};
$('upCopy').onclick = async () => { try { await navigator.clipboard.writeText(upLast); $('upCopy').textContent = 'Copied'; } catch { $('upCopy').textContent = 'Copy failed'; } setTimeout(() => { $('upCopy').textContent = 'Copy report'; }, 1500); };

async function loadCache() {
  const r = await call('cache-info'); $('chInfo').textContent = 'Krunker is using ' + (r.bytes / 1048576).toFixed(0) + ' MB of cache.'; $('chLimit').value = String(r.limitMb);
}
$('chLimit').onchange = () => call('cache-limit', Number($('chLimit').value)); $('chNow').onclick = async () => { await call('clear-cache'); toast('Cache cleared'); loadCache(); };

const THEME_LIST = [['aurora', 'Aurora Glass', 'Frosted glass over a teal and violet glow'], ['sky', 'Sky', 'Bright blue and airy'], ['midnight', 'Midnight', 'Near-black with a cool blue accent'], ['crimson', 'Crimson Night', 'Dark red, sharp and bold'], ['emerald', 'Emerald', 'Deep green with mint highlights'], ['sunset', 'Sunset', 'Warm orange and pink'], ['slate', 'Slate', 'Quiet grey, no colour']];
function applyTheme(t) { document.body.dataset.theme = t || 'aurora'; document.querySelectorAll('.theme-tile').forEach((b) => b.classList.toggle('on', b.dataset.t === document.body.dataset.theme)); }
function loadThemes() {
  const g = $('thGrid'); g.replaceChildren();
  THEME_LIST.forEach((t) => { const b = el('button', 'theme-tile'); b.dataset.t = t[0]; b.append(el('i'), el('b', '', t[1]), el('span', '', t[2]));
    b.onclick = async () => { prefs.theme = t[0]; applyTheme(t[0]); await call('bg-save', prefs); toast(t[1] + ' applied'); }; g.append(b); });
  applyTheme(prefs.theme);
}
applyTheme('aurora');
function applyFx() { document.body.dataset.fx = prefs.fx === false ? 'off' : 'on'; const c = $('thFx'); if (c) c.checked = prefs.fx !== false; }
$('thFx').onchange = async () => { prefs.fx = $('thFx').checked; applyFx(); await call('bg-save', prefs); };

// Brightness, glass and motion (Themes page). The sliders apply while you drag and are saved when you let go.
function applyLook() {
  const b = document.body.style;
  b.setProperty('--lift', (prefs.bright / 100 * 0.14).toFixed(3));
  b.setProperty('--bgb', (0.78 + prefs.bright / 100 * 0.52).toFixed(2));
  b.setProperty('--pa', (0.24 + prefs.glass / 100 * 0.68).toFixed(2));
  document.body.dataset.anim = prefs.anim === false ? 'off' : 'on';
  if ($('thBright')) { $('thBright').value = prefs.bright; $('thBrightV').textContent = prefs.bright; $('thGlass').value = prefs.glass; $('thGlassV').textContent = prefs.glass; $('thAnim').checked = prefs.anim !== false; }
}
$('thBright').addEventListener('input', () => { prefs.bright = Number($('thBright').value); applyLook(); });
$('thGlass').addEventListener('input', () => { prefs.glass = Number($('thGlass').value); applyLook(); });
$('thBright').addEventListener('change', () => call('bg-save', prefs));
$('thGlass').addEventListener('change', () => call('bg-save', prefs));
$('thAnim').onchange = async () => { prefs.anim = $('thAnim').checked; applyLook(); await call('bg-save', prefs); };
const LOOKS = { bright: [85, 36, 0], balanced: [62, 42, 8], dark: [18, 72, 35] };
document.querySelectorAll('[data-look]').forEach((c) => c.addEventListener('click', async () => {
  const v = LOOKS[c.dataset.look]; prefs.bright = v[0]; prefs.glass = v[1]; prefs.dim = v[2]; $('bDim').value = v[2]; applyLook(); applyBg(); await call('bg-save', prefs); toast('Look: ' + c.textContent.replace(' (default)', ''));
}));

// Motion helpers: stagger numbers for the entrance animation, a ripple on buttons, numbers that count up.
function stagger(root) { Array.from(root.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 12)))); }
document.querySelectorAll('#pills button').forEach((b, i) => b.style.setProperty('--i', String(i)));
document.querySelectorAll('#body nav > *').forEach((b, i) => b.style.setProperty('--i', String(i)));
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.btn, #pills button, #restartBtn, nav button'); if (!t || prefs.anim === false) return;
  const r = t.getBoundingClientRect(); const d = Math.max(r.width, r.height); const s = document.createElement('span'); s.className = 'rip';
  s.style.width = s.style.height = d + 'px'; s.style.left = (e.clientX - r.left - d / 2) + 'px'; s.style.top = (e.clientY - r.top - d / 2) + 'px';
  t.append(s); setTimeout(() => s.remove(), 650);
});
function countUp(node, text) {
  const n = Number(text);
  if (prefs.anim === false || !Number.isFinite(n) || text === '' || n === 0) { node.textContent = text; return; }
  const dec = text.indexOf('.') >= 0 ? text.length - text.indexOf('.') - 1 : 0; const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / 700); const e = 1 - Math.pow(1 - k, 3); node.textContent = (n * e).toFixed(dec); if (k < 1) requestAnimationFrame(step); else node.textContent = text; };
  requestAnimationFrame(step);
}
window.addEventListener('blur', () => document.body.classList.add('idle'));
window.addEventListener('focus', () => document.body.classList.remove('idle'));

// ── Performance doctor ──
let drReport = '';
async function runDoctor() {
  $('drRun').disabled = true; $('drSum').textContent = 'Checking... (about 2 seconds)'; $('drList').textContent = '';
  try {
    const r = await call('perf-doctor'); drReport = r.report;
    $('drSum').textContent = r.counts.bad ? r.counts.bad + ' problem(s) and ' + r.counts.warn + ' warning(s) found' : r.counts.warn ? r.counts.warn + ' warning(s), nothing serious' : 'Nothing wrong found';
    r.items.forEach((i, n) => { const row = el('div', 'drrow ' + i.level); row.style.setProperty('--i', String(Math.min(n, 12))); row.append(el('b', '', i.title), el('span', '', i.detail)); $('drList').append(row); });
    $('drCopy').hidden = false;
  } catch (e) { $('drSum').textContent = 'The check failed: ' + String(e && e.message || e); }
  $('drRun').disabled = false;
}
$('drRun').onclick = runDoctor;
$('drCopy').onclick = async () => { if (drReport) { await call('copy-text', drReport); toast('Report copied'); } };

// ── Krunker news ──
async function loadNews(force) {
  $('newsStatus').textContent = 'Loading...';
  let r; try { r = await call('news', force === true); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
  const box = $('newsList'); box.textContent = '';
  if (!r.ok) { $('newsStatus').textContent = 'Could not load the news (' + r.error + '). Check your connection and press Refresh.'; return; }
  $('newsStatus').textContent = r.stale ? 'You are offline: showing the last saved news.' : 'Updated ' + r.feed.generated;
  const add = (c) => {
    const card = el('div', 'card newscard'); card.append(el('h2', '', c.label + ' - ' + c.title));
    if (c.intro) card.append(el('p', '', c.intro));
    if (c.sections.length) { const tg = el('div', 'tags'); c.sections.forEach((t) => tg.append(el('span', 'tag', t))); card.append(tg); }
    const row = el('div', 'row'); if (c.videos) row.append(el('span', 'meta', c.videos + (c.videos > 1 ? ' videos' : ' video')));
    const b = el('button', 'btn ghost', 'Read on KRH'); b.onclick = () => call('news-open', c.route); row.append(b); card.append(row); box.append(card);
  };
  r.feed.updates.forEach(add); r.feed.events.forEach(add); stagger(box);
}
$('newsRefresh').onclick = () => loadNews(true);
$('newsOpen').onclick = () => call('news-open', 'news-updates');

// ── Userscripts the client switched off ──
async function loadGuard() {
  let r; try { r = await call('guard-list'); } catch (e) { return; }
  $('guardCard').hidden = !r.items.length; const l = $('guardList'); l.textContent = '';
  r.items.forEach((i) => {
    const row = el('div', 'item'); row.append(el('span', '', i.file + ' - ' + i.reason));
    const on = el('button', 'btn ghost', 'Turn back on'); on.onclick = async () => { await call('guard-reenable', i.file); toast('Switched on again (reload the game to use it)'); loadGuard(); };
    const x = el('button', 'btn ghost', 'Dismiss'); x.onclick = async () => { await call('guard-dismiss', i.file); loadGuard(); };
    row.append(on, x); l.append(row);
  });
}

// ── Font ──
const FONTS = ${JSON.stringify(FONTS)};
const fontGroups = {};
FONTS.forEach((f) => {
  const o = document.createElement('option'); o.value = f[0]; o.textContent = f[1]; o.setAttribute('data-no-i18n', '');
  if (f[3]) { if (!fontGroups[f[3]]) { const og = document.createElement('optgroup'); og.label = f[3]; fontGroups[f[3]] = og; $('lgFont').append(og); } fontGroups[f[3]].append(o); }
  else $('lgFont').append(o);
});
function applyFontLook() {
  const b = document.body; const f = FONTS.find((x) => x[0] === prefs.font); let stack = f ? f[2] : '';
  if (prefs.font === 'custom') { const nm = String(prefs.fontCustom || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim(); stack = nm ? "'" + nm + "',sans-serif" : ''; }
  if (stack) { b.style.setProperty('--ufont', stack); b.dataset.ufont = ''; } else { b.style.removeProperty('--ufont'); delete b.dataset.ufont; }
  const g = f && f[4] ? f[4] : ''; let gl = document.getElementById('krhGfont');
  if (!g) { if (gl) gl.remove(); }
  else { const href = 'https://fonts.googleapis.com/css2?family=' + g + '&display=swap'; if (!gl) { gl = document.createElement('link'); gl.id = 'krhGfont'; gl.rel = 'stylesheet'; document.head.append(gl); } if (gl.getAttribute('href') !== href) gl.setAttribute('href', href); }
  if (prefs.color) { b.style.setProperty('--ink', prefs.color); b.style.setProperty('--dim', prefs.color + 'cc'); } else { b.style.removeProperty('--ink'); b.style.removeProperty('--dim'); }
  window.krhDash.setZoom(Number(prefs.size) || 100);
}
function syncLookControls() {
  $('lgFont').value = prefs.font || ''; $('lgCustom').value = prefs.fontCustom || '';
  $('lgCustomRow').hidden = prefs.font !== 'custom'; $('lgColorDef').checked = !prefs.color; if (prefs.color) $('lgColor').value = prefs.color;
  $('lgSize').value = prefs.size || 100; $('lgSizeV').textContent = (prefs.size || 100) + '%';
}
function commitLook() { applyFontLook(); $('lgCustomRow').hidden = prefs.font !== 'custom'; return call('bg-save', prefs); }
$('lgFont').onchange = () => { prefs.font = $('lgFont').value; commitLook(); };
$('lgCustom').oninput = () => { prefs.fontCustom = $('lgCustom').value; applyFontLook(); };
$('lgCustom').onchange = () => commitLook();
$('lgColor').oninput = () => { prefs.color = $('lgColor').value; $('lgColorDef').checked = false; applyFontLook(); };
$('lgColor').onchange = () => commitLook();
$('lgColorDef').onchange = () => { prefs.color = $('lgColorDef').checked ? '' : $('lgColor').value; commitLook(); };
$('lgSize').oninput = () => { prefs.size = Number($('lgSize').value); $('lgSizeV').textContent = prefs.size + '%'; };
$('lgSize').onchange = () => commitLook();
$('lgReset').onclick = () => { prefs.font = ''; prefs.fontCustom = ''; prefs.color = ''; prefs.size = 100; syncLookControls(); commitLook(); toast('Font reset'); };

// Coming back from hidden (you pressed the dashboard key in the game): play the entrance again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || prefs.anim === false) return;
  const a = $('app'); a.classList.remove('wake'); void a.offsetWidth; a.classList.add('wake'); refreshTip();
});
async function refreshTip() { try { const r = await call('keybinds'); const row = r.rows.find((x) => x.label.indexOf('dashboard') >= 0); if (row) $('tipKey').textContent = row.combo; } catch (e) { /* keep the default text */ } }
refreshTip();

loadGames();
call('info').then((i) => { $('ver').textContent = 'v' + i.version; $('verBig').textContent = 'KRH Client v' + i.version; $('verSub').textContent = 'Electron ' + i.electron + '  |  Chromium ' + i.chrome + '  |  ' + i.platform; $('wPath').textContent = i.swapDir; prefs = i.prefs; applyTheme(prefs.theme); applyFx(); applyLook(); applyBg(); applyFontLook(); syncLookControls(); loadGuard(); });
applyLook(); stagger($('p-home'));
`;

export const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KRH Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; script-src 'unsafe-inline'; img-src data: https:; font-src data: https://fonts.gstatic.com;">
<style>${CSS}</style></head><body>${BODY}<script>${JS}</script></body></html>`;

export const DASHBOARD_DATA_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(DASHBOARD_HTML);
