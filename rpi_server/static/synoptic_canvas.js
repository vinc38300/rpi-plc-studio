


window.addEventListener('unhandledrejection', function(e){ console.error('Promise rejection:', e.reason); });
window.addEventListener('error', function(e){
  console.error('JS Error: ' + e.message + ' line:' + e.lineno);
  if(e.error) console.error(e.error.stack || '');
});
// ═══════════════ BRIDGE ═══════════════
// pybridge est injecté par Python via QWebEngineScript avant le chargement de la page.
// File d'attente : si pybridge n'est pas encore prêt, on mémorise les appels
// et on les rejoue dès qu'il est disponible.
const _cbQueue = [];
let   _cbReady  = false;

function _flushCbQueue(){
  _cbReady = true;
  while(_cbQueue.length){
    const [m,a] = _cbQueue.shift();
    try{ if(window.pybridge[m]) window.pybridge[m](...a); }catch(e){}
  }
}

function cb(m,...a){
  // ── Moteur local desktop (pybridge Qt) ────────────────────────────
  if(_cbReady && window.pybridge && window.pybridge[m]){
    try{ window.pybridge[m](...a); }catch(e){ console.warn('[cb] erreur',m,e); }
  } else {
    _cbQueue.push([m,a]);
    if(_cbQueue.length > 50) _cbQueue.splice(0, _cbQueue.length - 50);
  }
  // ── RPI distant via HTTP (en parallèle) ───────────────────────────
  try{ _cbRpi(m,a); }catch(e){}
}

// Surveiller l'apparition de window.pybridge (polling léger toutes les 100ms)
(function _waitPybridge(){
  if(window.pybridge){
    _flushCbQueue();
  } else {
    setTimeout(_waitPybridge, 100);
  }
})();

// ═══════════════ ÉTAT ═══════════════
// Structure multi-pages
let pages=[{id:'P1',name:'Vue principale',widgets:[],background:null,bgImage:null,bgImageOpacity:0.8,bgImageFit:'cover',grid:20}];
let curPage=0;   // index de la page active
// Accesseurs pratiques
function pg(){return pages[curPage];}
function get_widgets(){return pg().widgets;}
// Compat : alias pour code existant
Object.defineProperty(window,'widgets',{get:()=>pg().widgets,set:(v)=>{pg().widgets=v;}});

let selected=null,editMode=false,showGrid=true;
let _simCurrentTab='sondes';
let idCounter=1,plcState={},rtBuffers={},dbTrendCache={};
let _bgImageCache={};  // cache : id → HTMLImageElement chargée

// ═══════════════ PILOTAGE RPI DISTANT ════════════════════════════════
let _rpiUrl = '';      // ex: "http://192.168.1.50:5000"
let _rpiConnected = false;
let _rpiCheckTimer = null;

window.setRpiUrl = function(url){
  _rpiUrl = (url||'').trim().replace(/\/+$/,'');
  _rpiConnected = false;
  clearTimeout(_rpiCheckTimer);
  if(_rpiUrl){ _checkRpiConnection(); }
  _updateRpiBadge();
};

function _updateRpiBadge(){
  const b=document.getElementById('rpi-conn-badge');
  if(!b) return;
  if(!_rpiUrl){ b.style.display='none'; return; }
  b.style.display='inline-block';
  b.textContent=_rpiConnected?'🟢 RPI':'🔴 RPI';
  b.title=_rpiConnected?'RPI connecté : '+_rpiUrl:'RPI hors ligne : '+_rpiUrl;
  b.style.color=_rpiConnected?'#3fb950':'#f85149';
  b.style.borderColor=_rpiConnected?'#3fb950':'#f85149';
}

function _checkRpiConnection(){
  if(!_rpiUrl) return;
  clearTimeout(_rpiCheckTimer);
  fetch(_rpiUrl+'/api/status',{method:'GET',signal:AbortSignal.timeout(2000)})
    .then(r=>{ if(r.ok){_rpiConnected=true;_updateRpiBadge();} })
    .catch(()=>{ _rpiConnected=false; _updateRpiBadge(); });
  _rpiCheckTimer=setTimeout(_checkRpiConnection,5000);
}

const _RPI_ROUTES={
  gpio_write:     a=>({url:'/api/gpio/write',     body:{pin:parseInt(a[0]),value:a[1]?1:0}}),
  register_write: a=>({url:'/api/register/write', body:{ref:a[0],value:parseFloat(a[1])}}),
  memory_write:   a=>({url:'/api/memory/write',   body:{ref:a[0],value:a[1]?1:0}}),
  av_write:       a=>({url:'/api/av/write',        body:{varname:a[0],value:parseFloat(a[1])}}),
  dv_write:       a=>({url:'/api/dv/write',        body:{varname:a[0],value:a[1]?true:false}}),
  plc_action:     a=>{
    if(a[0]==='plc_start') return {url:'/api/plc/start',body:{}};
    if(a[0]==='plc_stop')  return {url:'/api/plc/stop', body:{}};
    if(a[0]==='set_mem')   return {url:'/api/memory/write',body:{ref:a[1],value:1}};
    if(a[0]==='reset_mem') return {url:'/api/memory/write',body:{ref:a[1],value:0}};
    return null;
  },
};

function _cbRpi(m,args){
  // Si _rpiUrl vide → on est en mode web embarqué sur le RPi : URLs relatives
  const builder=_RPI_ROUTES[m];
  if(!builder) return;
  const req=builder(args);
  if(!req) return;
  fetch(_rpiUrl+req.url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(req.body),
    signal:AbortSignal.timeout(3000),
  })
  .then(r=>{ if(r.ok&&!_rpiConnected){_rpiConnected=true;_updateRpiBadge();} })
  .catch(()=>{ if(_rpiConnected){_rpiConnected=false;_updateRpiBadge();} });
}

// ── GPIO dynamiques — mis à jour via window.setGpioConfig() depuis le studio ──
let _SYNOPTIC_GPIO_OUT  = [];   // pins de sortie triées
let _SYNOPTIC_GPIO_IN   = [];   // pins d'entrée triées
let _SYNOPTIC_GPIO_NAMES = {}; // {pin: "nom"}

// ── ANA dynamiques — mis à jour via window.setAnalogConfig() depuis le studio ──
let _SYNOPTIC_ANA_NAMES = {}; // {ANA0: "Sonde 5", ANA4: "Sonde 1", …}
const RT_MAX=80;
let GRID=20,SNAP=true,bgColor=null,_dirty=false;
// État optimiste local pour DV toggle — mis à jour immédiatement au clic,
// effacé quand le serveur confirme la même valeur
const _dvOptimistic = {};

// Helper : lit une variable CSS de thème pour l'utiliser dans le canvas
const _cv = (() => {
  const cache = {}; let _frame = 0;
  return (name, fallback) => {
    const key = name + '|' + document.documentElement.className;
    if (!cache[key]) {
      cache[key] = getComputedStyle(document.documentElement)
                     .getPropertyValue(name).trim() || fallback;
    }
    return cache[key];
  };
})();
// Alias courts pour les couleurs de thème fréquentes
function _bg()  { return _cv('--bg',  '#0d1117'); }
function _bg2() { return _cv('--bg2', '#161b22'); }
function _bg3() { return _cv('--bg3', '#1c2128'); }
function _bg4() { return _cv('--bg4', '#21262d'); }
function _txt() { return _cv('--text','#e6edf3'); }
function _t2()  { return _cv('--text2','#8b949e'); }
function _brd() { return _cv('--border','#30363d'); }
// Vider le cache à chaque changement de thème
function _clearCvCache(){ for(const k in _cv.__cache__||{}){ delete _cv.__cache__[k]; } }
let userImages=[];
let _dragType=null,_dragSym=null,_dragImgId=null;
// Navigation
let navHistory=[];      // historique des pages visitées (indices)
let showNavBar=true;    // barre de navigation fixe visible par defaut
let popupPageIdx=null;  // index de la page affichée en popup (null = fermé)
let _popupCtx=null;     // contexte 2D du canvas popup
const _imgCache={},_svgCache={};

// ═══════════════ API PYTHON → JS ═══════════════
function updatePLCState(s){
  // Effacer les états optimistes dont le serveur a confirmé la valeur
  if(s.dv_vars){
    for(const k of Object.keys(_dvOptimistic)){
      const kL=k.toLowerCase();
      const sv=s.dv_vars[k]!==undefined?s.dv_vars[k]:s.dv_vars[kL];
      if(sv!==undefined&&sv===_dvOptimistic[k])delete _dvOptimistic[k];
    }
  }
  plcState=s;_updateRtBuf(s);
  try{_simRefreshValues(s);}catch(e){}
  const run=s.cycle>0;
  const b=document.getElementById('sim-badge');
  if(b){b.textContent=run?'◉ Simulation':'◎ Simulation';b.className=run?'':'off';}
  const cb=document.getElementById('cycle-badge');
  if(cb) cb.textContent=run?`#${s.cycle}`:'';
  // requestAnimationFrame évite les conflits avec Qt WebEngine
  if(!editMode) requestAnimationFrame(()=>renderAll());
}
function loadSynopticData(js){
  try{
    let d = (typeof js === 'string') ? JSON.parse(js) : js;
    if(typeof d === 'string') d = JSON.parse(d);

    // ── Format multi-pages (nouveau) ──
    if(d.pages && Array.isArray(d.pages)){
      pages = d.pages.map((p,i)=>({
        id: p.id||('P'+(i+1)),
        name: p.name||('Page '+(i+1)),
        widgets: p.widgets||[],
        background: p.background||null,
        grid: p.grid||20,
        isPopup: false,  // popup désactivé - toujours pages normales
        popupW:  p.popupW||640,
        popupH:  p.popupH||480,
      }));
      if(pages.length===0) pages=[{id:'P1',name:'Vue principale',widgets:[],background:null,bgImage:null,bgImageOpacity:0.8,bgImageFit:'cover',grid:20}];
      curPage = Math.min(d.curPage||0, pages.length-1);
    } else {
      // ── Format ancien (rétrocompat) ──
      pages = [{id:'P1',name:'Vue principale',
                widgets:d.widgets||[],background:d.background||null,grid:d.grid||20}];
      curPage = 0;
    }
    // Sync GRID/bgColor sur la page active
    GRID = pg().grid||20;
    bgColor = pg().background||null;
    const _gsel=document.getElementById('syn-grid-select');
    if(_gsel){let _f=false;for(const _o of _gsel.options){if(parseInt(_o.value)===GRID){_o.selected=true;_f=true;break;}}if(!_f)_gsel.value=String(GRID);}

    userImages=d.images||[];
    // Recalculer idCounter
    let maxId=0;
    pages.forEach(p=>p.widgets.forEach(w=>{const m=w.id.match(/[0-9]+$/);const n=m?parseInt(m[0]):0;if(n>maxId)maxId=n;}));
    idCounter=maxId+1;

    showNavBar=d.showNavBar||false;
    if(d.rpiUrl !== undefined){ window.setRpiUrl(d.rpiUrl||''); }
    // Migration : si bgImage est un dataUrl (ancien format), le convertir en référence id
    pages.forEach(pg=>{
      if(pg.bgImage && pg.bgImage.startsWith('data:')){
        const id='BG_'+pg.id;
        if(!userImages.find(i=>i.id===id)){
          userImages.push({id,name:'[fond]',dataUrl:pg.bgImage,_isBg:true,_pageId:pg.id});
        }
        pg.bgImage=id;
      }
    });
    const _nb=document.getElementById('nav-fixed-bar');
    const _nbt=document.getElementById('nav-bar-toggle');
    if(_nb){_nb.className=showNavBar?'visible':'';}
    if(_nbt){_nbt.className='tbtn'+(showNavBar?' on':'');}
    navHistory=[];
    _dirty=false;
    renderPagesBar();
    renderNavFixed();
    // ── Normalisation rétrocompat (anciens projets) ─────────────────────
    pages.forEach(pg2 => pg2.widgets.forEach(w => {
      // thermo : ref → varRef, hi_thresh/lo_thresh → alarmHigh/alarmLow
      if(w.type==='thermo'){
        if(!w.varRef && w.ref) w.varRef = w.ref;
        if(w.alarmHigh===undefined && w.hi_thresh!==undefined) w.alarmHigh = w.hi_thresh;
        if(w.alarmLow===undefined  && w.lo_thresh!==undefined) w.alarmLow  = w.lo_thresh;
        w.type = 'temperature';   // alias → rTemp existant
      }
      // numeric : ref → varRef
      if(w.type==='numeric'){
        if(!w.varRef && w.ref) w.varRef = w.ref;
      }
      // alarm_led : variable → varRef, GPIO23 → gpio key
      if(w.type==='alarm_led'){
        if(!w.varRef && w.variable) w.varRef = w.variable.replace('GPIO','');
        if(!w.color   && w.color_alarm)  w.colorOn  = w.color_alarm;
        if(!w.colorOff && w.color_normal) w.colorOff = w.color_normal;
        w.type = 'alarm_light';   // alias → rAlarm existant
      }
      // nav_btn : target_page → targetPage
      if(w.type==='nav_btn'){
        if(!w.targetPage && w.target_page) w.targetPage = w.target_page;
        w.type = 'nav_page';      // alias → rNavPage existant
      }
      // back_btn : target_page → targetPage
      if(w.type==='back_btn'){
        if(!w.targetPage && w.target_page) w.targetPage = w.target_page;
        w.type = 'nav_back';      // alias → rNavBack existant
      }
      // relay : pin → varRef (numéro GPIO)
      if(w.type==='switch_m'){
    h+=`<div class="prop-section">Variable DV</div>
    <div class="prop-row"><div class="prop-label">Nom DV</div>
    <input type="text" class="prop-input" data-key="varRef" value="${w.varRef||''}"
      placeholder="ex: BP_Marche" style="font-family:monospace;font-size:11px;"></div>`
    +pT('label','Label',w.label||'')
    +pC('color','Couleur ON',w.color||'#3fb950');
  }
  if(w.type==='relay'){
        if(!w.varRef && w.pin!==undefined) w.varRef = String(w.pin);
        if(!w.onLabel  && w.text_on)  w.onLabel  = w.text_on;
        if(!w.offLabel && w.text_off) w.offLabel = w.text_off;
        if(!w.color    && w.color_on) w.color    = w.color_on;
      }
      // switch_m : dv → varRef, utilise dv_toggle comme base
      if(w.type==='switch_m'){
        if(!w.varRef && w.dv) w.varRef = w.dv;
        w.type = 'switch_m';      // gardé — géré par rSwitchM ci-dessous
      }
    }));
    renderAll();
    _refreshImgPanel();
    // Callback pour le mode mobile (fit-to-width)
    if(typeof window.onSynopticLoaded === 'function') window.onSynopticLoaded();
  }catch(e){toast('Erreur chargement : '+e.message,'err');}
}
// Expose les dimensions de la page courante (utilisé par le fit-to-width mobile)
window.getSynopticBounds = function(){
  var ws = pg().widgets || [];
  if(!ws.length) return {xMax:1200, yMax:800};
  var xMax=0, yMax=0;
  ws.forEach(function(w){ xMax=Math.max(xMax,(w.x||0)+(w.w||0)); yMax=Math.max(yMax,(w.y||0)+(w.h||0)); });
  return {xMax:xMax||1200, yMax:yMax||800};
};
function getSynopticJSON(){
  // Sauvegarder GRID et bgColor de la page active
  pg().grid = GRID;
  pg().background = bgColor;
  return JSON.stringify({pages,curPage,images:userImages,showNavBar,rpiUrl:_rpiUrl});
}
function doAction(a,r){
  if(a==='set_dv')   { writeDV(r, true);  return; }
  if(a==='reset_dv') { writeDV(r, false); return; }
  if(a==='pulse_dv') {
    writeDV(r, true);
    setTimeout(()=>writeDV(r, false), 200);
    return;
  }
  cb('plc_action',a,r||'');
}
function toggleRelay(p,s){cb('gpio_write',String(p),s?1.0:0.0);}
function writeRegister(r,v){cb('register_write',r,parseFloat(v));}
function writeMemory(r,v){cb('memory_write',r,v?1.0:0.0);}

// ═══════════════ NAVIGATION SIDEBAR ═══════════════
const _tabLabels={widgets:'📊 Widgets PLC',symbols:'🏭 Symboles P&ID',images:'🖼 Images'};
function switchTab(name){
  ['widgets','symbols','images'].forEach(t=>{
    const tabEl   = document.getElementById('tab-'+t);
    const panelEl = document.getElementById('panel-'+t);
    if(!tabEl || !panelEl) return;
    if(t===name){
      tabEl.classList.add('active');
      panelEl.classList.add('active');
      panelEl.style.display='flex';
    } else {
      tabEl.classList.remove('active');
      panelEl.classList.remove('active');
      panelEl.style.display='none';
    }
  });
}

// ═══════════════ BIBLIOTHÈQUE SYMBOLES P&ID ═══════════════
const SYM_GROUPS={
  vannes:[
    {id:'v_gate',     label:'Vanne porte',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="16" y2="20" stroke="#58a6ff" stroke-width="2.5"/><line x1="24" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="2.5"/><polygon points="16,12 24,20 16,28" fill="none" stroke="#58a6ff" stroke-width="1.8"/><polygon points="24,12 16,20 24,28" fill="none" stroke="#58a6ff" stroke-width="1.8"/></svg>`},
    {id:'v_ball',     label:'Vanne boule',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="13" y2="20" stroke="#58a6ff" stroke-width="2.5"/><line x1="27" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="2.5"/><circle cx="20" cy="20" r="7" fill="none" stroke="#58a6ff" stroke-width="1.8"/><line x1="20" y1="13" x2="20" y2="27" stroke="#58a6ff" stroke-width="1.8"/></svg>`},
    {id:'v_butterfly',label:'Vanne papillon',svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="15" y2="20" stroke="#58a6ff" stroke-width="2.5"/><line x1="25" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="2.5"/><ellipse cx="20" cy="20" rx="5" ry="9" fill="none" stroke="#58a6ff" stroke-width="1.8"/><line x1="20" y1="11" x2="20" y2="10" stroke="#58a6ff" stroke-width="1.5"/><rect x="15" y="8" width="10" height="3" rx="1" fill="none" stroke="#58a6ff" stroke-width="1.2"/></svg>`},
    {id:'v_check',    label:'Clapet AR',     svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="16" y2="20" stroke="#58a6ff" stroke-width="2.5"/><line x1="24" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="2.5"/><polygon points="16,12 24,20 16,28" fill="#58a6ff25" stroke="#58a6ff" stroke-width="1.8"/><line x1="24" y1="12" x2="24" y2="28" stroke="#58a6ff" stroke-width="2"/></svg>`},
    {id:'v_safety',   label:'Soupape sécu.', svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="22" x2="35" y2="22" stroke="#58a6ff" stroke-width="2.5"/><polygon points="16,13 24,22 16,31" fill="none" stroke="#58a6ff" stroke-width="1.8"/><polygon points="24,13 16,22 24,31" fill="none" stroke="#58a6ff" stroke-width="1.8"/><line x1="20" y1="8" x2="20" y2="13" stroke="#f85149" stroke-width="2"/><polygon points="17,8 20,3 23,8" fill="#f85149"/></svg>`},
    {id:'v_control',  label:'Vanne régul.',  svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="22" x2="16" y2="22" stroke="#58a6ff" stroke-width="2.5"/><line x1="24" y1="22" x2="35" y2="22" stroke="#58a6ff" stroke-width="2.5"/><polygon points="16,14 24,22 16,30" fill="none" stroke="#58a6ff" stroke-width="1.8"/><polygon points="24,14 16,22 24,30" fill="none" stroke="#58a6ff" stroke-width="1.8"/><circle cx="20" cy="10" r="4" fill="none" stroke="#d29922" stroke-width="1.5"/><line x1="20" y1="14" x2="20" y2="18" stroke="#d29922" stroke-width="1.5"/></svg>`},
  ],
  pompes:[
    {id:'p_centrifuge',label:'Pompe centr.',  svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="20" r="10" fill="none" stroke="#3fb950" stroke-width="1.8"/><line x1="5" y1="20" x2="12" y2="20" stroke="#3fb950" stroke-width="2.5"/><line x1="22" y1="10" x2="22" y2="5" stroke="#3fb950" stroke-width="2.5"/><path d="M14 20 Q18 14 22 14 Q26 14 28 18" fill="none" stroke="#3fb950" stroke-width="1.5"/></svg>`},
    {id:'p_gear',      label:'Pompe engr.',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="13" width="20" height="14" rx="3" fill="none" stroke="#3fb950" stroke-width="1.8"/><circle cx="17" cy="20" r="4" fill="none" stroke="#3fb950" stroke-width="1.5"/><circle cx="23" cy="20" r="4" fill="none" stroke="#3fb950" stroke-width="1.5"/><line x1="5" y1="20" x2="10" y2="20" stroke="#3fb950" stroke-width="2.5"/><line x1="30" y1="20" x2="35" y2="20" stroke="#3fb950" stroke-width="2.5"/></svg>`},
    {id:'motor',       label:'Moteur',        svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="12" fill="none" stroke="#d29922" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="10" fill="#d29922" font-family="sans-serif">M</text><line x1="5" y1="20" x2="8" y2="20" stroke="#d29922" stroke-width="2.5"/></svg>`},
    {id:'fan',         label:'Ventilateur',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="4" fill="none" stroke="#00d4ff" stroke-width="1.8"/><path d="M20 16 Q24 10 28 12 Q26 18 20 16Z" fill="none" stroke="#00d4ff" stroke-width="1.5"/><path d="M24 20 Q30 24 28 28 Q22 26 24 20Z" fill="none" stroke="#00d4ff" stroke-width="1.5"/><path d="M20 24 Q16 30 12 28 Q14 22 20 24Z" fill="none" stroke="#00d4ff" stroke-width="1.5"/><path d="M16 20 Q10 16 12 12 Q18 14 16 20Z" fill="none" stroke="#00d4ff" stroke-width="1.5"/></svg>`},
    {id:'compressor',  label:'Compresseur',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="11" fill="none" stroke="#bc8cff" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="9" fill="#bc8cff" font-family="sans-serif">C</text><line x1="5" y1="20" x2="9" y2="20" stroke="#bc8cff" stroke-width="2.5"/><line x1="31" y1="20" x2="35" y2="20" stroke="#bc8cff" stroke-width="2.5"/></svg>`},
    {id:'agitator',    label:'Agitateur',     svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="20" y1="5" x2="20" y2="28" stroke="#f0883e" stroke-width="2"/><line x1="13" y1="23" x2="27" y2="28" stroke="#f0883e" stroke-width="2"/><line x1="13" y1="28" x2="27" y2="23" stroke="#f0883e" stroke-width="2"/><circle cx="20" cy="5" r="3" fill="none" stroke="#f0883e" stroke-width="1.5"/></svg>`},
  ],
  capteurs:[
    {id:'s_temp',    label:'Sonde T°',       svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="17" y="5" width="6" height="20" rx="3" fill="none" stroke="#00d4ff" stroke-width="1.8"/><circle cx="20" cy="29" r="5" fill="none" stroke="#00d4ff" stroke-width="1.8"/><line x1="20" y1="25" x2="20" y2="29" stroke="#00d4ff" stroke-width="1.5"/><text x="20" y="17" text-anchor="middle" font-size="7" fill="#00d4ff">T</text></svg>`},
    {id:'s_pressure',label:'Capteur press.', svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="12" fill="none" stroke="#d29922" stroke-width="1.8"/><line x1="20" y1="20" x2="27" y2="13" stroke="#d29922" stroke-width="2"/><text x="20" y="30" text-anchor="middle" font-size="7" fill="#d29922">P</text></svg>`},
    {id:'s_flow',    label:'Débitmètre',     svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="35" y2="20" stroke="#3fb950" stroke-width="2.5"/><circle cx="20" cy="20" r="8" fill="none" stroke="#3fb950" stroke-width="1.8"/><path d="M14 20 L18 16 L22 20 L26 16" fill="none" stroke="#3fb950" stroke-width="1.5"/></svg>`},
    {id:'s_level',   label:'Capteur niveau', svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="12" y="8" width="16" height="24" rx="2" fill="none" stroke="#58a6ff" stroke-width="1.8"/><rect x="13" y="22" width="14" height="9" fill="#58a6ff25"/><text x="20" y="19" text-anchor="middle" font-size="7" fill="#58a6ff">L</text></svg>`},
    {id:'s_ph',      label:'pH-mètre',       svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="15" y="6" width="10" height="28" rx="5" fill="none" stroke="#bc8cff" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="8" fill="#bc8cff">pH</text></svg>`},
    {id:'s_vibro',   label:'Vibration',      svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M8 20 Q11 13 14 20 Q17 27 20 20 Q23 13 26 20 Q29 27 32 20" fill="none" stroke="#f85149" stroke-width="2"/><text x="20" y="35" text-anchor="middle" font-size="7" fill="#f85149">Vib</text></svg>`},
  ],
  reservoirs:[
    {id:'tank_v',  label:'Cuve verticale',  svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="6" width="20" height="28" rx="2" fill="none" stroke="#58a6ff" stroke-width="1.8"/><ellipse cx="20" cy="6" rx="10" ry="3" fill="none" stroke="#58a6ff" stroke-width="1.5"/><ellipse cx="20" cy="34" rx="10" ry="3" fill="none" stroke="#58a6ff" stroke-width="1.5"/></svg>`},
    {id:'tank_h',  label:'Cuve horiz.',     svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="12" width="28" height="16" rx="8" fill="none" stroke="#58a6ff" stroke-width="1.8"/></svg>`},
    {id:'silo',    label:'Silo',            svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><polygon points="10,7 30,7 28,30 12,30" fill="none" stroke="#d29922" stroke-width="1.8"/><polygon points="12,30 28,30 24,36 16,36" fill="none" stroke="#d29922" stroke-width="1.8"/><ellipse cx="20" cy="7" rx="10" ry="3" fill="none" stroke="#d29922" stroke-width="1.5"/></svg>`},
    {id:'pit',     label:'Bac rétention',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><polygon points="5,8 35,8 30,32 10,32" fill="none" stroke="#8b949e" stroke-width="1.8"/></svg>`},
  ],
  echangeurs:[
    {id:'hx',      label:'Échangeur',       svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="12" width="24" height="16" rx="3" fill="none" stroke="#f0883e" stroke-width="1.8"/><line x1="5" y1="16" x2="8" y2="16" stroke="#00d4ff" stroke-width="2"/><line x1="32" y1="16" x2="35" y2="16" stroke="#00d4ff" stroke-width="2"/><line x1="5" y1="24" x2="8" y2="24" stroke="#f85149" stroke-width="2"/><line x1="32" y1="24" x2="35" y2="24" stroke="#f85149" stroke-width="2"/><path d="M12 16 Q16 20 12 24" fill="none" stroke="#f0883e" stroke-width="1.2"/><path d="M20 16 Q24 20 20 24" fill="none" stroke="#f0883e" stroke-width="1.2"/><path d="M28 16 Q24 20 28 24" fill="none" stroke="#f0883e" stroke-width="1.2"/></svg>`},
    {id:'condenser',label:'Condenseur',     svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="14" width="24" height="12" rx="6" fill="none" stroke="#00d4ff" stroke-width="1.8"/><line x1="5" y1="20" x2="8" y2="20" stroke="#00d4ff" stroke-width="2.5"/><line x1="32" y1="20" x2="35" y2="20" stroke="#00d4ff" stroke-width="2.5"/><line x1="16" y1="8" x2="16" y2="14" stroke="#f85149" stroke-width="2"/><line x1="24" y1="8" x2="24" y2="14" stroke="#f85149" stroke-width="2"/></svg>`},
    {id:'boiler',  label:'Chaudière',       svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><ellipse cx="20" cy="22" rx="12" ry="10" fill="none" stroke="#f85149" stroke-width="1.8"/><line x1="20" y1="12" x2="20" y2="7" stroke="#f85149" stroke-width="2"/><path d="M16 7 Q20 3 24 7" fill="none" stroke="#f85149" stroke-width="1.5"/><line x1="5" y1="25" x2="8" y2="25" stroke="#58a6ff" stroke-width="2"/><line x1="32" y1="25" x2="35" y2="25" stroke="#58a6ff" stroke-width="2"/></svg>`},
    {id:'filter',  label:'Filtre',          svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="12" y2="20" stroke="#3fb950" stroke-width="2.5"/><line x1="28" y1="20" x2="35" y2="20" stroke="#3fb950" stroke-width="2.5"/><rect x="12" y="11" width="16" height="18" rx="2" fill="none" stroke="#3fb950" stroke-width="1.8"/><line x1="15" y1="14" x2="15" y2="26" stroke="#3fb950" stroke-width="1"/><line x1="18" y1="14" x2="18" y2="26" stroke="#3fb950" stroke-width="1"/><line x1="21" y1="14" x2="21" y2="26" stroke="#3fb950" stroke-width="1"/><line x1="24" y1="14" x2="24" y2="26" stroke="#3fb950" stroke-width="1"/></svg>`},
  ],
  elec:[
    {id:'e_motor',   label:'Moteur élec.',  svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="11" fill="none" stroke="#d29922" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="10" fill="#d29922" font-family="sans-serif">M</text></svg>`},
    {id:'transfo',   label:'Transformateur',svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="20" r="7" fill="none" stroke="#d29922" stroke-width="1.8"/><circle cx="25" cy="20" r="7" fill="none" stroke="#d29922" stroke-width="1.8"/><line x1="5" y1="20" x2="8" y2="20" stroke="#d29922" stroke-width="2"/><line x1="32" y1="20" x2="35" y2="20" stroke="#d29922" stroke-width="2"/></svg>`},
    {id:'breaker',   label:'Disjoncteur',   svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="14" y2="20" stroke="#f85149" stroke-width="2.5"/><line x1="26" y1="20" x2="35" y2="20" stroke="#f85149" stroke-width="2.5"/><rect x="14" y="13" width="12" height="14" rx="2" fill="none" stroke="#f85149" stroke-width="1.8"/><line x1="17" y1="17" x2="23" y2="23" stroke="#f85149" stroke-width="1.5"/></svg>`},
    {id:'contactor', label:'Contacteur',    svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="14" y2="20" stroke="#3fb950" stroke-width="2.5"/><line x1="26" y1="20" x2="35" y2="20" stroke="#3fb950" stroke-width="2.5"/><circle cx="14" cy="20" r="2.5" fill="#3fb950"/><circle cx="26" cy="20" r="2.5" fill="#3fb950"/><line x1="16" y1="18" x2="24" y2="18" stroke="#3fb950" stroke-width="2"/><line x1="20" y1="14" x2="20" y2="18" stroke="#3fb950" stroke-width="1.5"/></svg>`},
    {id:'coil_k',    label:'Bobine relais', svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><line x1="5" y1="20" x2="12" y2="20" stroke="#bc8cff" stroke-width="2.5"/><line x1="28" y1="20" x2="35" y2="20" stroke="#bc8cff" stroke-width="2.5"/><circle cx="20" cy="20" r="8" fill="none" stroke="#bc8cff" stroke-width="1.8"/><text x="20" y="24" text-anchor="middle" font-size="9" fill="#bc8cff" font-family="sans-serif">K</text></svg>`},
    {id:'light_hl',  label:'Voyant',        svg:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="10" fill="#3fb95030" stroke="#3fb950" stroke-width="1.8"/><circle cx="20" cy="20" r="6" fill="#3fb95050"/><text x="20" y="34" text-anchor="middle" font-size="7" fill="#3fb950">HL</text></svg>`},
  ],
};

function _buildSymGrids(){
  const map={vannes:'sg-vannes',pompes:'sg-pompes',capteurs:'sg-capteurs',reservoirs:'sg-reservoirs',echangeurs:'sg-echangeurs',elec:'sg-elec'};
  Object.entries(map).forEach(([grp,did])=>{
    const c=document.getElementById(did);if(!c)return;
    SYM_GROUPS[grp].forEach(sym=>{
      const el=document.createElement('div');el.className='sym-cell';el.draggable=true;el.dataset.symId=sym.id;
      el.title=sym.label;
      el.innerHTML=sym.svg+`<div class="sym-label">${sym.label}</div>`;
      // Drag & drop
      el.addEventListener('dragstart',e=>{_dragSym={type:'symbol',symId:sym.id,label:sym.label,svg:sym.svg};_dragType=null;_dragImgId=null;e.dataTransfer.effectAllowed='copy';});
      c.appendChild(el);
    });
  });
  // ── Groupe animés ──────────────────────────────────────────────────
  const ca=document.getElementById('sg-anim');if(!ca)return;
  Object.entries(ANIM_SYMBOLS).forEach(([id,def])=>{
    const el=document.createElement('div');el.className='sym-cell';el.draggable=true;
    el.title=def.label;
    el.innerHTML=def.preview+`<div class="sym-label">${def.label}</div>`;
    el.style.borderColor='#f0883e30';
    el.addEventListener('dragstart',e=>{
      _dragSym={type:'animated',animId:id,label:def.label};
      _dragType=null;_dragImgId=null;e.dataTransfer.effectAllowed='copy';
    });
    ca.appendChild(el);
  });
}
function _findSym(id){for(const g of Object.values(SYM_GROUPS)){const s=g.find(s=>s.id===id);if(s)return s;}return null;}

// ═══════════════ IMAGES ═══════════════
document.getElementById('img-file-input').addEventListener('change',ev=>{
  [...ev.target.files].forEach(f=>{
    const r=new FileReader();
    r.onload=e=>{const id='IMG'+(Date.now()+Math.random()|0);userImages.push({id,name:f.name,dataUrl:e.target.result});_refreshImgPanel();_dirty=true;toast(`Image : ${f.name}`,'ok');};
    r.readAsDataURL(f);
  });
  ev.target.value='';
});
function _refreshImgPanel(){
  const g=document.getElementById('img-grid'),e=document.getElementById('img-empty');
  if(!g)return;  // panneau pas encore dans le DOM
  g.innerHTML='';
  if(!userImages.length){if(e)e.style.display='';return;}
  if(e)e.style.display='none';
  userImages.forEach(img=>{
    if(img._isBg) return;  // images de fond : ne pas afficher dans la palette
    const c=document.createElement('div');c.className='img-thumb';c.draggable=true;c.dataset.imgId=img.id;
    c.innerHTML=`<img src="${img.dataUrl}" alt="${img.name}"><button class="img-del" onclick="deleteImg('${img.id}',event)">✕</button><div class="img-name">${img.name}</div>`;
    c.addEventListener('dragstart',e=>{_dragImgId=img.id;_dragSym=null;_dragType=null;e.dataTransfer.effectAllowed='copy';});
    g.appendChild(c);
  });
}
function deleteImg(id,e){
  e.stopPropagation();
  userImages=userImages.filter(i=>i.id!==id);
  widgets=widgets.filter(w=>!(w.type==='image'&&w.imageId===id));
  delete _imgCache[id];_refreshImgPanel();renderAll();_dirty=true;toast('Image supprimée','info');
}

// ═══════════════ CANVAS ═══════════════
const cvs=document.getElementById('syn-canvas');
let ctx=cvs.getContext('2d');
let _activeHtmlDiv=null; // null = use getElementById; set during popup render
// Toujours utiliser cette fonction pour accéder au conteneur HTML overlay
function _getHtmlDiv(){
  return _activeHtmlDiv || document.getElementById('widgets-html');
}
// Compatibilité avec le code existant qui référence htmlDiv
Object.defineProperty(window,'htmlDiv',{
  get(){ return _getHtmlDiv(); },
  configurable:true
});

function _resize(){
  const w=document.getElementById('canvasWrap');cvs.width=w.clientWidth;cvs.height=w.clientHeight;
  const _hd=_getHtmlDiv();if(_hd){_hd.style.width=cvs.width+'px';_hd.style.height=cvs.height+'px';}renderAll();
  // Hook fit-to-width : synoptic.html enregistre window.onAfterResize = _fitToWidth
  // pour que applyMode() → _resize() → refit automatique (desktop ET mobile)
  if(typeof window.onAfterResize==='function') window.onAfterResize();
}
window.addEventListener('resize',_resize);
// ═══════════════ GESTION DES PAGES ═══════════════
function renderPagesBar(){
  const bar=document.getElementById('pages-bar');
  if(!bar)return;
  bar.innerHTML='';
  pages.forEach((p,i)=>{
    const tab=document.createElement('span');
    const isPopup=p.isPopup||false;
    tab.className='page-tab'+(i===curPage?' active':'')+(editMode?' edit-mode-tab':'')+(isPopup?' popup-tab':'');
    if(isPopup){tab.style.cssText='border-style:dashed;border-color:var(--purple);color:var(--purple);';}
    // Nom cliquable
    const lbl=document.createElement('span');
    lbl.textContent=p.name;
    lbl.onclick=()=>{ if(p.isPopup) openPopup(i); else switchPage(i); };
    // Double-clic pour renommer (mode édition)
    lbl.ondblclick=()=>{
      if(!editMode)return;
      const n=prompt('Renommer la page :',p.name);
      if(n&&n.trim()){p.name=n.trim();_dirty=true;renderPagesBar();}
    };
    tab.appendChild(lbl);
    // Bouton supprimer (mode édition, si >1 page)
    if(editMode&&pages.length>1){
      const del=document.createElement('span');
      del.className='page-tab-del';del.textContent='✕';
      del.title='Supprimer cette page';
      del.onclick=(e)=>{e.stopPropagation();deletePage(i);};
      tab.appendChild(del);
    }
    bar.appendChild(tab);
  });
  // Bouton ajouter page (mode édition)
  if(editMode){
    const sep=document.createElement('div');sep.id='pages-bar-sep';bar.appendChild(sep);
    const add=document.createElement('span');
    add.className='page-tab-add';add.textContent='+';add.title='Ajouter une page normale';
    add.onclick=()=>addPage(false);
    bar.appendChild(add);
    const addPopup=document.createElement('span');
    addPopup.className='page-tab-add';
    addPopup.style.cssText='border-color:var(--purple);color:var(--purple);margin-left:2px;font-size:12px;padding:2px 8px;';
    addPopup.textContent='⊞';addPopup.title='Ajouter un sous-menu popup';
    addPopup.onclick=()=>addPage(true);
    bar.appendChild(addPopup);
  }
}

function switchPage(idx, addToHistory=true){
  if(idx<0||idx>=pages.length)return;
  // Si la page est un popup → l'ouvrir en overlay au lieu de basculer
  if(pages[idx].isPopup){ openPopup(idx); return; }
  // Sauvegarder GRID/bgColor dans la page qui part
  pg().grid=GRID; pg().background=bgColor;
  // Historique
  if(addToHistory && curPage!==idx){
    navHistory.push(curPage);
    if(navHistory.length>20) navHistory.shift();
  }
  // Basculer
  curPage=idx; selected=null; _multiSel=new Set(); _rubber=null;
  // Restaurer GRID/bgColor de la nouvelle page
  GRID=pg().grid||20; bgColor=pg().background||null;
  const _gsel=document.getElementById('syn-grid-select');
  if(_gsel){let _f=false;for(const _o of _gsel.options){if(parseInt(_o.value)===GRID){_o.selected=true;_f=true;break;}}if(!_f)_gsel.value=String(GRID);}
  renderPagesBar();
  renderNavFixed();
  renderAll();
  // Callback mobile : recalculer le fit-to-width sur changement de page
  if(typeof window.onSynopticLoaded === 'function') window.onSynopticLoaded();
}

// Navigation pas-à-pas entre pages normales (ignore les popups)
function navStepPage(delta){
  const normalPages=pages.map((p,i)=>i).filter(i=>!pages[i].isPopup);
  const pos=normalPages.indexOf(curPage);
  if(pos===-1)return;
  const newPos=pos+delta;
  if(newPos>=0&&newPos<normalPages.length) switchPage(normalPages[newPos]);
}

function navBack(){
  if(navHistory.length===0){
    // Plus de pages à revenir → basculer en mode Édition si on est en mode Opérateur
    if(!editMode) toggleMode();
    return;
  }
  const prev=navHistory.pop();
  switchPage(prev, false); // false = ne pas ajouter au history
}

function toggleNavBar(){
  showNavBar=!showNavBar;
  const bar=document.getElementById('nav-fixed-bar');
  const btn=document.getElementById('nav-bar-toggle');
  if(bar){bar.className=showNavBar?'visible':'';}
  if(btn){btn.className='tbtn'+(showNavBar?' on':'');}
  renderNavFixed();
}

function renderNavFixed(){
  const bc=document.getElementById('nav-breadcrumb');
  const backBtn=document.getElementById('nav-back-btn');
  const prevBtn=document.getElementById('nav-prev-btn');
  const nextBtn=document.getElementById('nav-next-btn');
  const counter=document.getElementById('nav-page-counter');
  if(!bc||!backBtn)return;
  // Fil d'Ariane : page 0 > ... > page courante
  const trail=[...navHistory, curPage].filter((v,i,a)=>a.indexOf(v)===i);
  // Simplifier : montrer seulement origine + courant si longue
  let crumbs=[];
  if(trail.length<=4){
    crumbs=trail;
  } else {
    crumbs=[trail[0], '...', trail[trail.length-2], trail[trail.length-1]];
  }
  bc.innerHTML='';
  crumbs.forEach((idx,i)=>{
    if(idx==='...'){
      const sep=document.createElement('span');sep.className='nav-breadcrumb-sep';sep.textContent='…';bc.appendChild(sep);
      return;
    }
    if(i>0){const s=document.createElement('span');s.className='nav-breadcrumb-sep';s.textContent='›';bc.appendChild(s);}
    const el=document.createElement('span');
    el.className='nav-breadcrumb-item'+(idx===curPage?' current':'');
    el.textContent=pages[idx]?.name||'?';
    if(idx!==curPage) el.onclick=()=>switchPage(idx);
    bc.appendChild(el);
  });
  // Bouton retour
  backBtn.disabled=navHistory.length===0;
  // Boutons précédent / suivant (pages normales uniquement)
  const normalPages=pages.map((p,i)=>i).filter(i=>!pages[i].isPopup);
  const pos=normalPages.indexOf(curPage);
  if(prevBtn) prevBtn.disabled=(pos<=0);
  if(nextBtn) nextBtn.disabled=(pos<0||pos>=normalPages.length-1);
  // Compteur de pages
  if(counter){
    const total=normalPages.length;
    const cur1=(pos>=0?pos+1:'-');
    counter.textContent=total>1?`${cur1} / ${total}`:'';
  }
}

function addPage(asPopup=false){
  const n=prompt((asPopup?'Nom du sous-menu popup :':'Nom de la nouvelle page :'),
    (asPopup?'Sous-menu ':(pages.length+1)));
  if(!n)return;
  pages.push({
    id:'P'+(Date.now()),name:n.trim(),
    widgets:[],background:null,grid:GRID,
    isPopup:false  // popup désactivé
  });
  _dirty=true;
  switchPage(pages.length-1);
}

function deletePage(idx){
  if(pages.length<=1){toast('Impossible : une page minimum','err');return;}
  if(!confirm('Supprimer la page "'+pages[idx].name+'" et tous ses widgets ?'))return;
  pages.splice(idx,1);
  if(curPage>=pages.length)curPage=pages.length-1;
  _dirty=true;
  renderPagesBar();renderAll();
}

// ═══════════════ WIDGET NAVIGATION PAGE ═══════════════
// ═══════════════ POPUP ═══════════════
function openPopup(idx){
  if(idx<0||idx>=pages.length)return;
  popupPageIdx=idx;
  const p=pages[idx];
  const overlay=document.getElementById('popup-overlay');
  const frame  =document.getElementById('popup-frame');
  const pcanvas=document.getElementById('popup-canvas');
  const pwhtml =document.getElementById('popup-widgets-html');
  const ptitle =document.getElementById('popup-title-bar');

  if(!overlay||!pcanvas||!pwhtml)return;

  // Dimensionner le popup : 80% du canvas principal, max 900×650
  const maxW=Math.min(cvs.width*0.85, 960);
  const maxH=Math.min(cvs.height*0.85, 680);
  // Taille définie par la page ou auto
  const pw=Math.min(p.popupW||maxW, maxW);
  const ph=Math.min(p.popupH||maxH, maxH);
  pcanvas.width=pw; pcanvas.height=ph;
  frame.style.width=pw+'px'; frame.style.height=ph+'px';
  pwhtml.style.width=pw+'px'; pwhtml.style.height=ph+'px';

  ptitle.textContent=p.name;
  overlay.classList.add('visible');

  _popupCtx=pcanvas.getContext('2d');
  _renderPopupPage(idx, pcanvas, pwhtml);
}

function closePopup(){
  popupPageIdx=null;
  const overlay=document.getElementById('popup-overlay');
  if(overlay)overlay.classList.remove('visible');
  setTimeout(()=>document.body.focus(),0);
}

function _popupOverlayClick(e){
  // Fermer si clic sur le fond (pas sur le frame)
  if(e.target===document.getElementById('popup-overlay')) closePopup();
}

function _renderPopupPage(idx, pcanvas, pwhtml){
  if(idx===null||!_popupCtx)return;
  const p=pages[idx];
  const ctx2=_popupCtx;
  const W=pcanvas.width, H=pcanvas.height;
  pwhtml.innerHTML='';

  // Fond
  ctx2.fillStyle=p.background||getComputedStyle(document.documentElement)
    .getPropertyValue('--canvas-default-bg').trim()||'#0d1117';
  ctx2.fillRect(0,0,W,H);

  // Titre
  const titleH=28;
  ctx2.fillStyle=_bg2(); ctx2.fillRect(0,0,W,titleH);
  ctx2.strokeStyle=_brd(); ctx2.lineWidth=1;
  ctx2.beginPath(); ctx2.moveTo(0,titleH); ctx2.lineTo(W,titleH); ctx2.stroke();
  ctx2.fillStyle=_t2(); ctx2.font='bold 11px "Segoe UI",sans-serif';
  ctx2.textAlign='left'; ctx2.textBaseline='middle';
  ctx2.fillText(p.name, 12, titleH/2);

  // Rendre les widgets avec un contexte décalé de titleH
  p.widgets.forEach(w=>{
    _renderWidgetInPopup(ctx2,pwhtml,{...w,y:w.y+titleH},titleH);
  });
  _activeHtmlDiv=null;
}

function _renderWidgetInPopup(ctx2, pwhtml, w, offsetY){
  const _ctx=ctx;
  ctx=ctx2;
  _activeHtmlDiv=pwhtml||null;
  try{renderW(w);}catch(e){}
  ctx=_ctx;
}

function rNavBack(w,canvasOnly){
  const c  = w.color  || '#475569';
  const bg = w.bg     || '#1e293b';
  const icon= w.icon  || '←';
  const shape = w.shape || 'rect';
  const label = w.label || 'Retour';

  ctx.fillStyle=bg;
  if(shape==='pill'){
    rr(ctx,w.x,w.y,w.w,w.h,w.h/2); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=1.5; ctx.stroke();
  } else if(shape==='arrow'){
    const ah=w.h*0.4, mx=w.x+ah;
    ctx.beginPath();
    ctx.moveTo(w.x+w.w-6,w.y); ctx.lineTo(mx,w.y);
    ctx.lineTo(w.x+2,w.y+w.h/2);
    ctx.lineTo(mx,w.y+w.h); ctx.lineTo(w.x+w.w-6,w.y+w.h);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=1.5; ctx.stroke();
  } else {
    rr(ctx,w.x,w.y,w.w,w.h,8); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=1.5; ctx.stroke();
  }
  // Icône à droite
  const cx=w.x+w.w-14, cy=w.y+w.h/2;
  ctx.fillStyle=c; ctx.font=`bold ${Math.min(14,w.h*0.5)}px sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(icon, cx, cy);
  // Texte
  const fs=Math.min(12, w.h*0.38);
  ctx.fillStyle=w.textColor||_txt();
  ctx.font=`600 ${fs}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label, w.x+w.w/2-6, cy);

  if(!editMode){
    hov(w,`<button onclick="navBack()" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;border-radius:${shape==='pill'?w.h/2:8}px;" title="${label}"></button>`,canvasOnly);
  }
}

function rNavPage(w,canvasOnly){
  const c  = w.color  || '#2563eb';
  const bg = w.bg     || '#1a2f45';
  const icon= w.icon  || '→';
  const shape = w.shape || 'rect'; // rect | pill | arrow
  const label = w.label || 'Vue suivante';

  // Fond
  ctx.fillStyle=bg;
  if(shape==='pill'){
    rr(ctx,w.x,w.y,w.w,w.h,w.h/2); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=1.5; ctx.stroke();
  } else if(shape==='arrow'){
    // Forme flèche pointant à droite
    const ah=w.h*0.4, mx=w.x+w.w-ah;
    ctx.beginPath();
    ctx.moveTo(w.x+6,w.y); ctx.lineTo(mx,w.y);
    ctx.lineTo(w.x+w.w-2,w.y+w.h/2);
    ctx.lineTo(mx,w.y+w.h); ctx.lineTo(w.x+6,w.y+w.h);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=1.5; ctx.stroke();
  } else {
    rr(ctx,w.x,w.y,w.w,w.h,8); ctx.fill();
    ctx.strokeStyle=c; ctx.lineWidth=2; ctx.stroke();
  }

  // Icône à gauche
  const iconX = w.x+14, cy = w.y+w.h/2;
  ctx.fillStyle=c; ctx.font=`bold ${Math.min(16,w.h*0.55)}px sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(icon, iconX, cy);

  // Texte centré entre icône et bord droit
  const fs=Math.min(12, w.h*0.38, w.w/10+5);
  ctx.fillStyle=w.textColor||_txt();
  ctx.font=`600 ${fs}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label, w.x+w.w/2+8, cy);

  // Cible (sous le label, petite)
  if(editMode && w.targetPage!==undefined && w.targetPage!==''){
    const tname = typeof w.targetPage==='number'
      ? (pages[w.targetPage]?.name||'?') : String(w.targetPage);
    ctx.fillStyle=c+'99'; ctx.font=`9px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillText('→ '+tname, w.x+w.w/2, w.y+w.h-3);
  }

  if(!editMode){
    hov(w,`<button onclick="window._navPageGo('${w.targetPage??''}')" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;border-radius:${shape==='pill'?w.h/2:8}px;" title="${label}"></button>`,canvasOnly);
  }
}
window._navPageGo=function(target){
  if(!target&&target!==0)return;
  let idx=pages.findIndex(p=>p.id===String(target));
  if(idx<0)idx=pages.findIndex(p=>p.name===String(target));
  if(idx<0&&/^\d+$/.test(String(target)))idx=parseInt(target);
  if(idx<0||idx>=pages.length)return;
  if(pages[idx].isPopup)openPopup(idx);else switchPage(idx);
};

function setSynGrid(px){
  GRID=Math.max(1,px);
  const sel=document.getElementById('syn-grid-select');
  if(sel){
    let found=false;
    for(const o of sel.options){if(parseInt(o.value)===GRID){o.selected=true;found=true;break;}}
    if(!found) sel.value=String(GRID);
  }
  renderAll();
}
function toggleSynSnap(){
  SNAP=!SNAP;
  const btn=document.getElementById('syn-snap-btn');
  if(btn){
    btn.textContent=SNAP?'⊞ Snap':'⬜ Libre';
    btn.className='snap-btn '+(SNAP?'snap-on':'snap-off');
  }
}
function _snap(v){return SNAP?Math.round(v/GRID)*GRID:Math.round(v);}

function _bg(){
  // ── Couleur de fond ─────────────────────────────────────────────
  ctx.fillStyle=bgColor||getComputedStyle(document.documentElement).getPropertyValue('--canvas-default-bg').trim()||'#0d1117';
  ctx.fillRect(0,0,cvs.width,cvs.height);

  // ── Image de fond de page ────────────────────────────────────────
  const _bgiRef = pg().bgImage;
  // Résoudre id → dataUrl si besoin
  const _bgiEntry = _bgiRef ? userImages.find(i=>i.id===_bgiRef) : null;
  const _bgi = _bgiEntry ? _bgiEntry.dataUrl : _bgiRef;
  if(_bgi){
    const _cached = _bgImageCache[_bgi];
    if(_cached && _cached.complete && _cached.naturalWidth>0){
      ctx.save();
      ctx.globalAlpha = pg().bgImageOpacity??0.8;
      const fit = pg().bgImageFit||'cover';
      const iw=_cached.naturalWidth, ih=_cached.naturalHeight;
      const cw=cvs.width, ch=cvs.height;
      let dx=0,dy=0,dw=cw,dh=ch;
      if(fit==='contain'){
        const sc=Math.min(cw/iw,ch/ih);
        dw=iw*sc; dh=ih*sc; dx=(cw-dw)/2; dy=(ch-dh)/2;
      } else if(fit==='cover'){
        const sc=Math.max(cw/iw,ch/ih);
        dw=iw*sc; dh=ih*sc; dx=(cw-dw)/2; dy=(ch-dh)/2;
      }
      ctx.drawImage(_cached,dx,dy,dw,dh);
      ctx.globalAlpha=1;
      ctx.restore();
    } else if(!_cached || (!_cached.complete)){
      if(!_cached){
        const img=new Image();
        img.onload=()=>{ _bgImageCache[_bgi]=img; renderAll(); };
        img.onerror=()=>{ delete _bgImageCache[_bgi]; };
        img.src=_bgi;
        _bgImageCache[_bgi]=img;
      }
    }
  }

  // ── Grille (mode édition) ────────────────────────────────────────
  if(!showGrid||!editMode)return;
  ctx.strokeStyle='rgba(48,54,61,0.5)';ctx.lineWidth=0.5;
  for(let x=0;x<cvs.width;x+=GRID){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,cvs.height);ctx.stroke();}
  for(let y=0;y<cvs.height;y+=GRID){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(cvs.width,y);ctx.stroke();}
}
// ═══════════════ DEFAULTS ═══════════════
const WD={
  temperature:{w:140,h:90, label:'Sonde 1',varRef:'ANA0',unit:'°C', color:'#00d4ff',bg:'#0a1f2a',alarmHigh:85,alarmLow:3},
  gauge:      {w:120,h:120,label:'Jauge',  varRef:'RF0', unit:'°C', color:'#d080ff',bg:'#1a0a2a',min:0,max:100},
  av_display: {w:160,h:80, label:'Variable',varRef:'av0', unit:'',  color:'#ffa030',bg:'#1a1000', decimals:1},
  bar:        {w:40, h:120,label:'Niveau', varRef:'RF0', unit:'%',  color:'#3fb950',bg:'#0a2010',min:0,max:100},
  trend:      {w:220,h:100,label:'Tendance',varRef:'ANA0',unit:'°C',color:'#58a6ff',bg:'#0d1f35',min:-10,max:100},
  trend_db:   {w:260,h:110,label:'Courbe historisée',varRef:'RF0',unit:'',color:'#bc8cff',bg:'#170d2a',hours:24},
  value:      {w:120,h:60, label:'Valeur', varRef:'RF0', unit:'',   color:'#e6edf3',bg:'#1c2128',decimals:1},
  relay:      {w:140,h:70, label:'Relais K1',varRef:'17',color:'#3fb950',onLabel:'ACTIF',offLabel:'inactif'},
  setpoint:   {w:160,h:80, label:'Consigne',varRef:'RF0',unit:'°C', color:'#d29922',min:0,max:100,step:0.5},
  numentry:   {w:180,h:90, label:'Consigne',varRef:'RF0',unit:'°C', color:'#e06c75',min:0,max:100,step:1,decimals:1},
  numeric:    {w:180,h:60, label:'Valeur',varRef:'RF0',unit:'',color:'#58a6ff',decimals:1},
  switch_m:   {w:260,h:44, label:'Interrupteur',varRef:'BP_Marche',color:'#3fb950'},
  button:     {w:120,h:50, label:'Démarrer',action:'plc_start',color:'#58a6ff',bg:'#1a2f45',btnStyle:'flat'},
  toggle:     {w:100,h:50, label:'Mode',   varRef:'M0', color:'#bc8cff'},
  dv_push:    {w:130,h:70, label:'Marche', varRef:'marche_pompe', color:'#f0883e', colorOff:'#484f58', momentary:true},
  dv_toggle:  {w:130,h:60, label:'Mode auto', varRef:'mode_auto', color:'#56d364', colorOff:'#484f58', onLabel:'ACTIF', offLabel:'inactif'},
  label:      {w:120,h:30, text:'Titre',   fontSize:14, color:'#e6edf3',bold:true, bg:'', gradientColor2:'', gradientDir:'horizontal', radius:4, align:'center'},
  rect:       {w:200,h:100,color:'#30363d',bg:'#161b22',radius:8,opacity:0.8,label:'',gradientColor2:'',gradientDir:'vertical'},
  pipe:       {w:200,h:20, color:'#58a6ff',thickness:8, horizontal:true},
  alarm_light:{w:60, h:60, label:'Alarme', varRef:'M0', colorOn:'#f85149',colorOff:'#484f58'},
  symbol:     {w:60, h:60, label:'',       symId:'v_gate',color:'#58a6ff',opacity:1.0,varRef:'',colorOn:'#3fb950',colorOff:'#484f58'},
  animated:   {w:90, h:90, label:'',       animId:'boiler',varRef:'M0',colorOn:'#f0883e',colorOff:'#484f58'},
  image:      {w:120,h:120,label:'',       imageId:'',  opacity:1.0,fit:'contain'},
  nav_page:   {w:160,h:50, label:'',targetPage:'',icon:'→',shape:'rect',color:'#2563eb',bg:'#1a2f45',textColor:''},
  cntdisplay: {w:180,h:100,label:'Compteur marche',blockId:'',color:'#50ff50',showStarts:true,showTotal:true,showRuntime:true},
  nav_back:   {w:120,h:44, label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b',textColor:''},
  // ── Formes de dessin ──────────────────────────────────────────────────────
  draw_circle:   {w:100,h:100, fill:'#1a2f45', stroke:'#58a6ff', strokeWidth:2, opacity:1.0, gradientColor2:'', gradientDir:'radial', label:'', bevel:0},
  draw_ellipse:  {w:140,h:80,  fill:'#1a2f45', stroke:'#3fb950', strokeWidth:2, opacity:1.0, gradientColor2:'', gradientDir:'vertical', label:'', bevel:0},
  draw_triangle: {w:100,h:90,  fill:'#2a1f35', stroke:'#bc8cff', strokeWidth:2, opacity:1.0, gradientColor2:'', gradientDir:'vertical', label:'', bevel:0},
  draw_line:     {w:160,h:4,   stroke:'#58a6ff', strokeWidth:3, lineDash:0, opacity:1.0, arrowEnd:false, label:''},
  // ── Widgets carte minimaliste ────────────────────────────────────────────
  temp_card:  {w:130,h:70,  label:'Température', varRef:'ANA0', unit:'°C', color:'#e53935', alarmHigh:85, alarmLow:3, bgCard:'#ffffff', textColor:'#1a1a2e'},
  sp_card:    {w:140,h:80,  label:'Consigne',    varRef:'RF0',  unit:'°C', color:'#1565c0', min:0, max:100, step:0.5, bgCard:'#ffffff', textColor:'#1a1a2e'},
  // ── Widgets 3D ──────────────────────────────────────────────────────────
  push_3d:      {w:80, h:80,  label:'START', varRef:'marche', color:'#22c55e', colorOff:'#374151', momentary:true},
  toggle_btn_3d:{w:80, h:80,  label:'ON/OFF', varRef:'marche', color:'#22c55e', colorOff:'#374151'},
  toggle_3d:    {w:90, h:50,  label:'Mode',  varRef:'M0',    color:'#3b82f6', colorOff:'#374151', onLabel:'ON', offLabel:'OFF'},
  btn_3d:       {w:120,h:50,  label:'Action',action:'plc_start', color:'#3b82f6', bg:'#1e3a5f'},
  // ── Widgets Blocs Métier ─────────────────────────────────────────────────
  plancher_w:  {w:220,h:165, label:'Plancher chauffant',     varRef:'',varSP:'',varDep:'',varRet:'',dvCirc:'',dvV3v:'',dvErr:''},
  chaudiere_w: {w:200,h:160, label:'Chaudière',              varRet:'',varDep:'',varSP:'',dvBrulee:'',dvPompe:'',dvAlm:''},
  solar_w:     {w:220,h:175, label:'Solaire thermique',      varCapt:'',varEcs:'',varChauf:'',varDelta:'',dvPompe:'',dvVanneEcs:'',dvVanneCh:'',dvAlm:''},
  zone_chauf_w:{w:200,h:165, label:'Zone chauffage',         varRef:'',varSP:'',dvVanne:'',dvActive:''},
  ecs_w:       {w:210,h:165, label:'Eau chaude sanitaire',   varEcs:'',varPrim:'',varSP:'',dvPompe:'',dvAlm:''},
  prog_h_w:    {w:240,h:160, label:'Planning Jour/Nuit', varSP:'',dvJour:'',dvVac:'',
               hDebut:6.5,hFin:22,
               days:[true,true,true,true,true,false,false],
               hDebuts:[6.5,6.5,6.5,6.5,6.5,8,8],
               hFins:[22,22,22,22,22,22,22]},
  // ── Texte dynamique ──────────────────────────────────────────────────────────
  dyn_text:    {w:200,h:36, label:'', varRef:'RF0',
               prefix:'', suffix:'', decimals:1,
               fontSize:16, color:'#e6edf3', bold:false,
               bg:'', radius:4, align:'left',
               map:''},       // ex: "0:Arrêt,1:Marche,2:Erreur"
};
function mkW(type,x,y,extra={}){return{id:'W'+(idCounter++),type,x,y,...JSON.parse(JSON.stringify(WD[type]||{})),...extra};}

// ═══════════════ RENDU ═══════════════

// Ne pas détruire les widgets HTML si un input/select est actif
// (évite la perte de focus pendant la saisie clavier)
function _hasActiveInput(){
  const a = document.activeElement;
  if(!a) return false;
  const tag = a.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Vérifier si l'élément actif est dans #widgets-html
  return !!a.closest('#widgets-html, #popup-widgets-html');
}

function renderAll(){
  _bg();
  // Recréer les widgets HTML uniquement si aucun input n'est en cours de saisie
  const _hd2=_getHtmlDiv();
  if(!_hasActiveInput()){
    if(_hd2) _hd2.innerHTML='';
    widgets.forEach(w=>renderW(w));
  } else {
    // Redessiner uniquement le canvas (pas les HTML widgets)
    widgets.forEach(w=>renderW(w, true));
  }
  if(selected&&editMode)_selBox(selected);
  // Contours multi-sélection
  if(editMode&&_multiSel.size>1){
    _multiSel.forEach(w=>{
      if(w===selected)return;
      ctx.strokeStyle='#58a6ff90';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
      ctx.strokeRect(w.x-3,w.y-3,w.w+6,w.h+6);ctx.setLineDash([]);
    });
    // Badge count
    ctx.fillStyle='#58a6ff';ctx.font='bold 11px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText(`${_multiSel.size} sélectionnés`,8,8);
  }
  // Rubber-band
  if(_rubber&&editMode){
    ctx.save();
    ctx.strokeStyle='#58a6ff';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);
    ctx.fillStyle='rgba(88,166,255,0.07)';
    ctx.fillRect(_rubber.x,_rubber.y,_rubber.w,_rubber.h);
    ctx.strokeRect(_rubber.x,_rubber.y,_rubber.w,_rubber.h);
    ctx.setLineDash([]);ctx.restore();
  }
}

// canvasOnly=true → skip hov() calls (ne recrée pas les éléments HTML)
let _renderCanvasOnly = false;

function _selBox(w){
  if(w.locked){
    // Cadre sélection verrouillé : orange tireté + badge "🔒 Verrouillé – propriétés visibles"
    ctx.strokeStyle='#f0883e';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);
    ctx.strokeRect(w.x-3,w.y-3,w.w+6,w.h+6);ctx.setLineDash([]);
    // Badge "🔒"
    const badge='🔒 Verrouillé';
    ctx.font='bold 9px sans-serif';
    const bw=ctx.measureText(badge).width+14;
    ctx.fillStyle='rgba(30,20,10,0.88)';
    ctx.fillRect(w.x,w.y-16,bw,15);
    ctx.fillStyle='#f0883e';ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText(badge,w.x+4,w.y-14);
    return;
  }
  // Les formes draw_* gèrent elles-mêmes leur overlay + handles via _drawEditOverlay
  if(w.type&&w.type.startsWith('draw_')) return;
  // Cadre de sélection principal
  ctx.save();
  ctx.strokeStyle='#f0883e';ctx.lineWidth=2;ctx.setLineDash([5,4]);
  ctx.strokeRect(w.x-2,w.y-2,w.w+4,w.h+4);ctx.setLineDash([]);
  ctx.restore();
  _drawHandles(w, true);
}

// ─── Poignées de redimensionnement en forme de L (style professionnel) ───────
function _drawHandles(w, isSel){
  const col = isSel ? '#f0883e' : '#58a6ff';
  const ARM = 10; // longueur du bras du L
  const TH  = 3;  // épaisseur du trait
  const R   = 5;  // rayon du cercle central
  const CORNERS = [
    {cx:w.x,      cy:w.y,      dx1:ARM, dy1:0,   dx2:0,   dy2:ARM,  // NW
     ax:1, ay:1},
    {cx:w.x+w.w,  cy:w.y,      dx1:-ARM,dy1:0,   dx2:0,   dy2:ARM,  // NE
     ax:-1,ay:1},
    {cx:w.x,      cy:w.y+w.h,  dx1:ARM, dy1:0,   dx2:0,   dy2:-ARM, // SW
     ax:1, ay:-1},
    {cx:w.x+w.w,  cy:w.y+w.h,  dx1:-ARM,dy1:0,   dx2:0,   dy2:-ARM, // SE
     ax:-1,ay:-1},
  ];
  ctx.save();
  ctx.lineCap='round';
  CORNERS.forEach(c=>{
    // Ombre portée
    ctx.shadowColor='rgba(0,0,0,0.55)';ctx.shadowBlur=5;ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
    // Bras horizontal du L
    ctx.strokeStyle=col;ctx.lineWidth=TH;
    ctx.beginPath();ctx.moveTo(c.cx,c.cy);ctx.lineTo(c.cx+c.dx1,c.cy+c.dy1);ctx.stroke();
    // Bras vertical du L
    ctx.beginPath();ctx.moveTo(c.cx,c.cy);ctx.lineTo(c.cx+c.dx2,c.cy+c.dy2);ctx.stroke();
    ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
    // Cercle central (poignée de prise)
    ctx.beginPath();ctx.arc(c.cx,c.cy,R,0,Math.PI*2);
    ctx.fillStyle='#1a2030';ctx.fill();
    ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();ctx.arc(c.cx,c.cy,R-2,0,Math.PI*2);
    ctx.fillStyle=col;ctx.fill();
  });

  // ─── Poignée de rotation (cercle au-dessus du centre haut) ─────────
  const ROT_OFFSET = 30; // px au-dessus du bord supérieur
  const rcx = w.x + w.w / 2;
  const rcy = w.y - ROT_OFFSET;
  // Ligne de liaison pointillée
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = col; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(rcx, w.y - 2); ctx.lineTo(rcx, rcy + 7); ctx.stroke();
  ctx.setLineDash([]);
  // Cercle extérieur (fond sombre)
  ctx.shadowColor='rgba(0,0,0,0.6)';ctx.shadowBlur=5;ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
  ctx.beginPath(); ctx.arc(rcx, rcy, 7, 0, Math.PI*2);
  ctx.fillStyle = '#1a2030'; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
  // Remplissage couleur
  ctx.beginPath(); ctx.arc(rcx, rcy, 5, 0, Math.PI*2);
  ctx.fillStyle = col; ctx.fill();
  // Icône ↺ (arc avec flèche)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(rcx, rcy, 2.8, -Math.PI * 0.75, Math.PI * 0.55); ctx.stroke();
  // Petite flèche au bout de l'arc
  const arrowAngle = Math.PI * 0.55;
  const ax = rcx + 2.8 * Math.cos(arrowAngle);
  const ay = rcy + 2.8 * Math.sin(arrowAngle);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - 2.2 * Math.cos(arrowAngle - 0.8), ay - 2.2 * Math.sin(arrowAngle - 0.8));
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - 2.2 * Math.cos(arrowAngle + 0.8), ay - 2.2 * Math.sin(arrowAngle + 0.8));
  ctx.stroke();

  ctx.restore();
}

// Retourne les coordonnées de la poignée de rotation d'un widget
function _rotHandlePos(w){ return {x: w.x+w.w/2, y: w.y-30}; }

// Écriture intelligente : RF* → register_write, M* → memory_write, sinon → av_write
function getCnt(bid,field){
  const p=plcState?.pids?.[bid];
  if(!p)return null;
  if(field==='starts') return p.starts??0;
  if(field==='total')  return (p.total??0)/3600;
  if(field==='runtime')return p.runtime??0;
  return null;
}

function writeVar(ref, val){
  if(!ref)return;
  if(ref.startsWith('RF'))  { cb('register_write', ref, parseFloat(val)); return; }
  if(ref.startsWith('M'))   { cb('memory_write',   ref, parseFloat(val)); return; }
  // Variable AV nommée
  cb('av_write', ref, parseFloat(val));
}
// Écriture booléenne : M* → memory_write, sinon → dv_write
// + mise à jour optimiste locale immédiate (évite le flicker sur clics rapides)
function writeDV(ref, val){
  if(!ref)return;
  const bval = val ? true : false;
  const refL = ref.toLowerCase();
  // État optimiste : refléter le changement localement sans attendre le serveur
  const _isMbit = /^M\d+$/.test(ref);
  if(!_isMbit){
    _dvOptimistic[ref]  = bval;   // original case
    _dvOptimistic[refL] = bval;   // FIX: 'Mardi' n'est pas un bit M
    renderAll();
  }
  if(_isMbit) { cb('memory_write', ref, bval ? 1.0 : 0.0); return; }
  cb('dv_write', ref, bval);  // envoyer le nom original (cohérent avec le RPi)
}
function writeRegister(r,v){ cb('register_write',r,parseFloat(v)); }
function writeMemory(r,v)  { cb('memory_write',r,v?1.0:0.0); }

// ═══════════════ IMAGE DE FOND DE PAGE ═══════════════════════════════
function setBgImage(dataUrl, fit, opacity){
  if(!dataUrl){ pg().bgImage=null; _dirty=true; renderAll(); showPageProps(); return; }
  // Stocker dans userImages avec flag _isBg pour ne pas dupliquer
  let existing = userImages.find(i=>i._isBg && i._pageId===pg().id);
  if(existing){
    existing.dataUrl = dataUrl;
  } else {
    const id = 'BG_'+pg().id;
    existing = {id, name:'[fond]', dataUrl, _isBg:true, _pageId:pg().id};
    userImages.push(existing);
    _refreshImgPanel();
  }
  pg().bgImage        = existing.id;   // stocker l'id, pas le dataUrl
  pg().bgImageFit     = fit     || 'cover';
  pg().bgImageOpacity = opacity != null ? opacity : 0.8;
  delete _bgImageCache[existing.id];
  _dirty=true; renderAll(); showPageProps();
  toast('Image de fond définie','ok');
}
function clearBgImage(){
  const bgId='BG_'+pg().id;
  userImages=userImages.filter(i=>i.id!==bgId);
  _refreshImgPanel();
  pg().bgImage=null; _dirty=true; renderAll(); showPageProps();
  toast('Image de fond supprimée','ok');
}
function _openBgImagePicker(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='image/*';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      // Stocker uniquement dans pg().bgImage — pas dans userImages pour éviter doublon
      setBgImage(ev.target.result, pg().bgImageFit||'cover', pg().bgImageOpacity??0.8);
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}

function getV(ref){
  if(!ref)return null;
  const s=plcState;
  if(s.analog?.[ref] !== undefined)return s.analog[ref]?.celsius??null;
  if(s.registers?.[ref]!==undefined)return parseFloat(s.registers[ref]);
  if(s.memory?.[ref]!==undefined)return s.memory[ref];
  if(s.gpio?.[ref]?.value!==undefined)return s.gpio[ref].value?1:0;
  // GPIO par numéro de pin (relay: varRef = String(pin))
  if(/^\d+$/.test(ref)){
    const gpin = s.gpio?.[ref];
    if(gpin?.value!==undefined) return gpin.value?1:0;
    // chercher aussi comme clé numérique
    const gpinN = s.gpio?.[parseInt(ref)];
    if(gpinN?.value!==undefined) return gpinN.value?1:0;
  }
  // Variables AV nommées (ex: "temp_interieur") — chercher tel quel puis en minuscules
  const refL=ref.toLowerCase();
  if(s.av_vars?.[ref]!==undefined)return parseFloat(s.av_vars[ref]);
  if(s.av_vars?.[refL]!==undefined)return parseFloat(s.av_vars[refL]);
  // Variables DV nommées — état optimiste local en priorité
  if(_dvOptimistic[ref]!==undefined)return _dvOptimistic[ref];
  if(_dvOptimistic[refL]!==undefined)return _dvOptimistic[refL];
  if(s.dv_vars?.[ref]!==undefined)return s.dv_vars[ref];
  if(s.dv_vars?.[refL]!==undefined)return s.dv_vars[refL];
  return null;
}

// Écriture intelligente : RF* → register_write, M* → memory_write, sinon → av_write
function getCnt(bid,field){
  const p=plcState?.pids?.[bid];
  if(!p)return null;
  if(field==='starts') return p.starts??0;
  if(field==='total')  return (p.total??0)/3600;
  if(field==='runtime')return p.runtime??0;
  return null;
}

function writeVar(ref, val){
  if(!ref)return;
  if(ref.startsWith('RF'))  { cb('register_write', ref, parseFloat(val)); return; }
  if(ref.startsWith('M'))   { cb('memory_write',   ref, parseFloat(val)); return; }
  // Variable AV nommée
  cb('av_write', ref, parseFloat(val));
}
// Écriture booléenne : M* → memory_write, sinon → dv_write
// + mise à jour optimiste locale immédiate (évite le flicker sur clics rapides)
function writeDV(ref, val){
  if(!ref)return;
  const bval = val ? true : false;
  const refL = ref.toLowerCase();
  // État optimiste : refléter le changement localement sans attendre le serveur
  const _isMbit = /^M\d+$/.test(ref);
  if(!_isMbit){
    _dvOptimistic[ref]  = bval;   // original case
    _dvOptimistic[refL] = bval;   // FIX: 'Mardi' n'est pas un bit M
    renderAll();
  }
  if(_isMbit) { cb('memory_write', ref, bval ? 1.0 : 0.0); return; }
  cb('dv_write', ref, bval);  // envoyer le nom original (cohérent avec le RPi)
}
function writeRegister(r,v){ cb('register_write',r,parseFloat(v)); }
function writeMemory(r,v)  { cb('memory_write',r,v?1.0:0.0); }


// ── Afficheur numérique simple (type 'numeric') ───────────────────────────
function rNumeric(w, val){
  const c = w.color||'#58a6ff';
  const bg = w.bg||_bg3();
  ctx.fillStyle = bg; ctx.strokeStyle = _brd(); ctx.lineWidth = 1;
  rr(ctx, w.x, w.y, w.w, w.h, 6); ctx.fill(); ctx.stroke();
  if(w.label){ ctx.fillStyle='#8b949e'; ctx.font='10px sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(w.label, w.x+6, w.y+4); }
  const dec = w.decimals!==undefined ? parseInt(w.decimals) : 1;
  const txt = (val!=null && !isNaN(val)) ? parseFloat(val).toFixed(dec)+(w.unit?' '+w.unit:'') : '—';
  ctx.fillStyle = c; ctx.font = `bold 18px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, w.x+w.w/2, w.y+w.h/2+(w.label?4:0));
}

// ── Interrupteur ON/OFF pour DV nommée (type 'switch_m') ─────────────────
function rSwitchM(w, val, canvasOnly){
  const on = !!val;
  const c  = on ? (w.color||'#3fb950') : '#484f58';
  const bg = on ? '#0d2010' : _bg3();
  ctx.fillStyle = bg; ctx.strokeStyle = c; ctx.lineWidth = on?2:1;
  rr(ctx, w.x, w.y, w.w, w.h, 8); ctx.fill(); ctx.stroke();
  // Indicateur rond
  ctx.fillStyle = c; ctx.beginPath();
  ctx.arc(w.x+14, w.y+w.h/2, 5, 0, Math.PI*2); ctx.fill();
  if(on){ ctx.strokeStyle = c+'60'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(w.x+14, w.y+w.h/2, 9, 0, Math.PI*2); ctx.stroke(); }
  // Label
  ctx.fillStyle = _t2(); ctx.font='11px sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='middle';
  const lbl = w.label||w.varRef||'';
  // Si label long : première partie avant " — "
  const parts = lbl.split(' — ');
  const mainLbl = parts[0]||lbl;
  ctx.fillText(mainLbl, w.x+26, w.y+w.h/2-(parts[1]?6:0));
  if(parts[1]){ ctx.fillStyle='#484f58'; ctx.font='9px sans-serif';
    ctx.fillText(parts[1], w.x+26, w.y+w.h/2+7); }
  // État texte
  ctx.fillStyle = c; ctx.font='bold 10px sans-serif';
  ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(on?'ON':'OFF', w.x+w.w-6, w.y+w.h/2);
  // Bouton cliquable
  if(!editMode) hov(w, `<button onclick="writeDV('${w.varRef}',${!on})"
    style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;"
    title="${on?'Désactiver':'Activer'} ${w.varRef}"></button>`, canvasOnly);
}

function renderW(w, canvasOnly){
  const v=getV(w.varRef);
  const ang=w.angle||0;
  if(ang){
    const cx=w.x+w.w/2, cy=w.y+w.h/2;
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(ang);
    ctx.translate(-cx,-cy);
  }
  switch(w.type){case'temperature':rTemp(w,v);break;case'gauge':rGauge(w,v);break;case'bar':rBar(w,v);break;case'trend':rTrend(w);break;case'trend_db':rTrendDb(w);break;case'value':rVal(w,v);break;case'relay':rRelay(w,v,canvasOnly);break;case'setpoint':rSP(w,v,canvasOnly);break;case'numentry':rNumEntry(w,v,canvasOnly);break;case'button':rBtn(w,canvasOnly);break;case'toggle':rToggle(w,v,canvasOnly);break;case'dv_push':rDvPush(w,v,canvasOnly);break;case'dv_toggle':rDvToggle(w,v,canvasOnly);break;case'label':rLabel(w);break;case'rect':rRect(w);break;case'pipe':rPipe(w);break;case'alarm_light':rAlarm(w,v);break;case'symbol':rSym(w,v);break;case'animated':rAnim(w,v,canvasOnly);break;case'image':rImg(w);break;case'nav_page':rNavPage(w,canvasOnly);break;case'nav_back':rNavBack(w,canvasOnly);break;case'cntdisplay':rCntDisplay(w);break;case'draw_circle':rDrawCircle(w);break;case'draw_ellipse':rDrawEllipse(w);break;case'draw_triangle':rDrawTriangle(w);break;case'draw_line':rDrawLine(w);break;case'temp_card':rTempCard(w,v);break;case'sp_card':rSpCard(w,v,canvasOnly);break;case'push_3d':rPush3d(w,v,canvasOnly);break;case'toggle_btn_3d':rToggleBtn3d(w,v,canvasOnly);break;case'toggle_3d':rToggle3d(w,v,canvasOnly);break;case'btn_3d':rBtn3d(w,canvasOnly);break;case'plancher_w':rPlancher(w);break;case'chaudiere_w':rChaudiere(w);break;case'solar_w':rSolar(w);break;case'zone_chauf_w':rZoneChauf(w);break;case'ecs_w':rEcsBloc(w);break;case'prog_h_w':rProgH(w);break;case'av_display':rAvDisplay(w,v);break;case'numeric':rNumeric(w,v);break;case'switch_m':rSwitchM(w,v,canvasOnly);break;case'dyn_text':rDynText(w,v);break;}
  if(ang) ctx.restore();
}

function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);c.lineTo(x+r,y+h);c.arcTo(x,y+h,x,y+h-r,r);c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);c.closePath();}
function hov(w,html,canvasOnly){if(editMode||canvasOnly)return;const _hd=_getHtmlDiv();if(!_hd)return;const d=document.createElement('div');d.style.cssText=`position:absolute;left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px;pointer-events:auto;`;d.innerHTML=html;_hd.appendChild(d);}

function rTemp(w,val){const al=val!=null&&(val>(w.alarmHigh??85)||val<(w.alarmLow??3)),c=al?'#f85149':(w.color||'#00d4ff');ctx.fillStyle=w.bg||_bg3();ctx.strokeStyle=al?'#f85149':_brd();ctx.lineWidth=al?2:1;rr(ctx,w.x,w.y,w.w,w.h,10);ctx.fill();ctx.stroke();ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(w.label||'Sonde',w.x+30,w.y+7);ctx.fillStyle=c;ctx.font='16px sans-serif';ctx.fillText('🌡',w.x+6,w.y+4);const txt=val!=null&&!isNaN(val)?val.toFixed(1)+'°C':'N/C';ctx.fillStyle=c;ctx.font=`bold ${val!=null?24:14}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(txt,w.x+w.w/2,w.y+w.h/2+8);const p=val!=null?Math.min(1,Math.max(0,(val+50)/200)):0;ctx.fillStyle=_bg4();rr(ctx,w.x+8,w.y+w.h-16,w.w-16,4,2);ctx.fill();ctx.fillStyle=c;rr(ctx,w.x+8,w.y+w.h-16,(w.w-16)*p,4,2);ctx.fill();const hi=w.alarmHigh??85,lo=w.alarmLow??3;ctx.fillStyle='#484f58';ctx.font='8px sans-serif';ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(`↑${hi}° ↓${lo}°`,w.x+8,w.y+w.h-18);}
function rGauge(w,val){const mn=w.min??0,mx=w.max??100,p=val!=null?Math.min(1,Math.max(0,(val-mn)/(mx-mn))):0,cx=w.x+w.w/2,cy=w.y+w.h/2+5,r=Math.min(w.w,w.h)/2-12,s=Math.PI*.75,e2=Math.PI*2.25,c=w.color||'#d080ff';ctx.fillStyle=w.bg||_bg3();rr(ctx,w.x,w.y,w.w,w.h,10);ctx.fill();ctx.strokeStyle=_bg4();ctx.lineWidth=8;ctx.lineCap='round';ctx.beginPath();ctx.arc(cx,cy,r,s,e2);ctx.stroke();ctx.strokeStyle=c;ctx.beginPath();ctx.arc(cx,cy,r,s,s+(e2-s)*p);ctx.stroke();ctx.fillStyle=c;ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(val!=null?val.toFixed(1):'—',cx,cy);ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textBaseline='top';ctx.fillText(w.label||'',cx,w.y+3);}
function rBar(w,val){const mn=w.min??0,mx=w.max??100,p=val!=null?Math.min(1,Math.max(0,(val-mn)/(mx-mn))):0,c=w.color||'#3fb950';ctx.fillStyle=w.bg||'#0d2010';rr(ctx,w.x,w.y,w.w,w.h,6);ctx.fill();const bh=(w.h-20)*p;ctx.fillStyle=c;rr(ctx,w.x+4,w.y+w.h-10-bh,w.w-8,bh,3);ctx.fill();ctx.fillStyle=c;ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(val!=null?val.toFixed(0)+(w.unit||''):'—',w.x+w.w/2,w.y+3);}
function rTrend(w){const buf=rtBuffers[w.varRef]||[],c=w.color||'#58a6ff';ctx.fillStyle=w.bg||'#0d1f35';rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(w.label||'',w.x+7,w.y+4);if(buf.length<2)return;const mn=Math.min(...buf.map(p=>p.y)),mx=Math.max(...buf.map(p=>p.y)),sp=mx-mn||1;const px=i=>w.x+5+(i/(buf.length-1))*(w.w-10),py=v=>w.y+w.h-7-((v-mn)/sp)*(w.h-20);ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.beginPath();buf.forEach((p,i)=>i===0?ctx.moveTo(px(i),py(p.y)):ctx.lineTo(px(i),py(p.y)));ctx.stroke();const lp=buf[buf.length-1];ctx.fillStyle=c;ctx.beginPath();ctx.arc(px(buf.length-1),py(lp.y),3,0,Math.PI*2);ctx.fill();ctx.font='bold 10px sans-serif';ctx.textAlign='right';ctx.textBaseline='top';ctx.fillText(lp.y.toFixed(1)+(w.unit||'°C'),w.x+w.w-5,w.y+4);}

// ── Courbe historisée (BDD, persistante) ──────────────────────────────────
// Contrairement à rTrend (buffer mémoire navigateur, perdu au reload), cette
// version interroge /api/history/<ref> côté serveur — la donnée survit aux
// rechargements de page et aux redémarrages du Raspberry Pi. Le ref suivi
// (RF/AV/mémoire) est simplement la propriété varRef du widget : le moteur
// PLC détecte automatiquement les widgets 'trend_db' présents dans
// synoptic.json et historise leurs varRef toutes les 5 minutes côté serveur.
function rTrendDb(w){
  const c=w.color||'#58a6ff';
  ctx.fillStyle=w.bg||'#0d1f35';rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();
  ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(w.label||w.varRef||'',w.x+7,w.y+4);

  const now=Date.now(),hours=w.hours||24;
  if(!dbTrendCache[w.id])dbTrendCache[w.id]={data:[],fetchedAt:0,loading:false};
  const cache=dbTrendCache[w.id];
  if(w.varRef && now-cache.fetchedAt>30000 && !cache.loading){
    cache.loading=true;
    fetch(`/api/history/${encodeURIComponent(w.varRef)}?hours=${hours}`)
      .then(r=>r.json())
      .then(rows=>{cache.data=rows;cache.fetchedAt=Date.now();cache.loading=false;})
      .catch(()=>{cache.loading=false;});
  }

  const buf=cache.data;
  if(!buf||buf.length<2){
    ctx.fillStyle='#484f58';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(cache.loading?'Chargement…':'Pas de données',w.x+w.w/2,w.y+w.h/2);
    return;
  }
  const tNow=Math.floor(now/1000),tMin=tNow-hours*3600;
  const mn=Math.min(...buf.map(p=>p.v)),mx=Math.max(...buf.map(p=>p.v)),sp=(mx-mn)||1;
  const px=ts=>w.x+5+((ts-tMin)/(tNow-tMin||1))*(w.w-10);
  const py=v=>w.y+w.h-16-((v-mn)/sp)*(w.h-30);
  ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.beginPath();
  buf.forEach((p,i)=>{const x=px(p.ts),y=py(p.v);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
  ctx.stroke();
  const lp=buf[buf.length-1];
  ctx.fillStyle=c;ctx.beginPath();ctx.arc(px(lp.ts),py(lp.v),3,0,Math.PI*2);ctx.fill();
  ctx.font='bold 10px sans-serif';ctx.textAlign='right';ctx.textBaseline='top';
  ctx.fillText(lp.v.toFixed(1)+(w.unit||''),w.x+w.w-5,w.y+4);
  ctx.fillStyle='#6e7681';ctx.font='9px sans-serif';ctx.textBaseline='bottom';
  ctx.textAlign='left'; ctx.fillText(`-${hours}h`,w.x+5,w.y+w.h-3);
  ctx.textAlign='right';ctx.fillText('maintenant',w.x+w.w-5,w.y+w.h-3);
}
function rVal(w,val){ctx.fillStyle=w.bg||_bg3();rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();ctx.fillStyle=_t2();ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(w.label||'',w.x+w.w/2,w.y+4);ctx.fillStyle=w.color||'#e6edf3';ctx.font='bold 16px sans-serif';ctx.textBaseline='middle';const v=val!=null?(isNaN(parseFloat(val))?String(val):parseFloat(val).toFixed(w.decimals??1)+(w.unit||'')):'—';ctx.fillText(v,w.x+w.w/2,w.y+w.h/2+4);}
function rAvDisplay(w,val){
  // Boîte fond
  ctx.fillStyle=w.bg||'#1a1000';
  ctx.strokeStyle=w.color||'#ffa030';
  ctx.lineWidth=1.5;
  rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();ctx.stroke();
  // Badge AV haut-gauche
  ctx.fillStyle=w.color||'#ffa030';
  ctx.font='bold 9px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText('AV: '+(w.varRef||'av0'),w.x+8,w.y+6);
  // Label
  ctx.fillStyle='#aaaaaa';
  ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
  ctx.fillText(w.label||w.varRef||'Variable',w.x+w.w/2,w.y+6);
  // Valeur principale
  const dec=w.decimals!=null?w.decimals:2;
  const unit=w.unit||'';
  const txt=val!=null&&!isNaN(parseFloat(val))?parseFloat(val).toFixed(dec)+unit:'—';
  ctx.fillStyle=w.color||'#ffa030';
  ctx.font=`bold 22px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(txt,w.x+w.w/2,w.y+w.h/2+6);
}
function rRelay(w,val,canvasOnly){const on=!!val,c=on?(w.color||'#3fb950'):'#484f58',bg=on?'#0d2010':_bg3();ctx.fillStyle=bg;ctx.strokeStyle=c;ctx.lineWidth=on?2:1;rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();ctx.stroke();ctx.fillStyle=c;ctx.beginPath();ctx.arc(w.x+14,w.y+w.h/2,5,0,Math.PI*2);ctx.fill();if(on){ctx.strokeStyle=c+'60';ctx.lineWidth=4;ctx.beginPath();ctx.arc(w.x+14,w.y+w.h/2,8,0,Math.PI*2);ctx.stroke();}ctx.fillStyle=_t2();ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(w.label||'',w.x+26,w.y+5);ctx.fillStyle=c;ctx.font='bold 12px sans-serif';ctx.textBaseline='bottom';ctx.fillText(on?(w.onLabel||'ACTIF'):(w.offLabel||'inactif'),w.x+26,w.y+w.h-5);if(!editMode){
    // Si varRef est un numéro GPIO → toggleRelay ; sinon → writeDV (variable nommée)
    const _isGpio = /^\d+$/.test(String(w.varRef||''));
    const _clickFn = _isGpio
      ? `toggleRelay('${w.varRef}',${on?0:1})`
      : `writeDV('${w.varRef}',${on?false:true})`;
    hov(w,`<button onclick="${_clickFn}" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;"></button>`,canvasOnly);
  }
}
function rSP(w,val,canvasOnly){
  const c=w.color||'#d29922';
  const dec=w.decimals??1;
  const dispVal=val!=null?parseFloat(val).toFixed(dec):'—';
  // Fond
  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,8); ctx.fill();
  ctx.strokeStyle=c+'60'; ctx.lineWidth=1.5; rr(ctx,w.x,w.y,w.w,w.h,8); ctx.stroke();
  // Label
  ctx.fillStyle=_t2(); ctx.font='10px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(w.label||'',w.x+7,w.y+4);
  // Indicateur cliquable (crayon)
  if(!editMode){
    ctx.fillStyle=c+'70'; ctx.font='10px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='top';
    ctx.fillText('✎',w.x+w.w-7,w.y+4);
  }
  // Valeur
  ctx.fillStyle=c; ctx.font='bold 18px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(dispVal+(w.unit||'°C'),w.x+w.w/2,w.y+w.h/2+3);
  if(!editMode){
    // Clic → popup saisie directe (pas de slider)
    hov(w,`<div onclick="_spEdit('${w.id}','${w.varRef}',${val!=null?parseFloat(val):(w.min||0)},${w.min||0},${w.max||100},${w.step||0.5},'${w.unit||'°C'}','${c}')" style="position:absolute;inset:0;cursor:text;border-radius:8px;"></div>`,canvasOnly);
  }
}

function rNumEntry(w,val,canvasOnly){
  const c=w.color||'#e06c75';
  const dec=w.decimals??1;
  const dispVal=val!=null?parseFloat(val).toFixed(dec):'—';
  const isAV = w.varRef && !w.varRef.startsWith('RF') && !/^M\d+$/.test(w.varRef) && isNaN(parseInt(w.varRef))  // FIX;
  // Fond
  ctx.fillStyle=_bg3();rr(ctx,w.x,w.y,w.w,w.h,10);ctx.fill();
  ctx.strokeStyle=c+'60';ctx.lineWidth=1.5;rr(ctx,w.x,w.y,w.w,w.h,10);ctx.stroke();
  // Label + badge AV/RF
  ctx.fillStyle=_t2();ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(w.label||'Consigne',w.x+9,w.y+6);
  // Badge petite indication à droite
  const badge = isAV ? `AV:${w.varRef}` : (w.varRef||'');
  ctx.fillStyle=c+'99';ctx.font='9px monospace';ctx.textAlign='right';ctx.textBaseline='top';
  ctx.fillText(badge,w.x+w.w-7,w.y+6);
  // Zone valeur actuelle (PLC)
  ctx.fillStyle=c+'22';rr(ctx,w.x+7,w.y+20,w.w-14,28,6);ctx.fill();
  ctx.fillStyle=c;ctx.font='bold 17px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(dispVal+(w.unit||''),w.x+w.w/2,w.y+34);
  // Zone saisie
  if(editMode){
    ctx.fillStyle='#30363d';rr(ctx,w.x+7,w.y+54,w.w-14,22,5);ctx.fill();
    ctx.fillStyle='#484f58';ctx.font='10px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('[ saisie opérateur ]',w.x+w.w/2,w.y+65);
  } else {
    hov(w,`
      <div style="position:absolute;left:7px;right:7px;bottom:8px;display:flex;gap:4px;align-items:center;">
        <input id="ne_${w.id}" type="number"
          min="${w.min??0}" max="${w.max??100}" step="${w.step??1}"
          value="${val!=null?parseFloat(val).toFixed(dec):''}"
          placeholder="Valeur..."
          style="flex:1;background:#0d1117;border:1.5px solid ${c}88;border-radius:5px;
                 color:${c};font:bold 13px monospace;padding:3px 7px;outline:none;
                 -moz-appearance:textfield;text-align:right;"
          onkeydown="if(event.key==='Enter'){const _v=parseFloat(this.value);if(!isNaN(_v)){writeVar('${w.varRef}',_v);this.blur();document.body.focus();this.style.borderColor='#3fb95099';setTimeout(()=>this.style.borderColor='${c}88',800);}}"
          onfocus="this.select();this.style.borderColor='${c}';"
          onblur="this.style.borderColor='${c}88';"
        >
        <button onclick="(()=>{const _nv=parseFloat(document.getElementById('ne_${w.id}').value);if(!isNaN(_nv))writeVar('${w.varRef}',_nv);document.body.focus();})();document.getElementById('ne_${w.id}').style.borderColor='#3fb95099';setTimeout(()=>document.getElementById('ne_${w.id}').style.borderColor='${c}88',800);"
          style="background:${c}22;border:1.5px solid ${c}88;border-radius:5px;color:${c};
                 font:bold 11px sans-serif;padding:3px 8px;cursor:pointer;white-space:nowrap;"
          title="Envoyer la valeur (ou appuyer sur Entrée)">↵</button>
      </div>`,canvasOnly);
  }
}
function rBtn(w,canvasOnly){
  const c=w.color||'#58a6ff', bg=w.bg||'#1a2f45';
  const st=w.btnStyle||'flat';
  const x=w.x,y=w.y,bw=w.w,bh=w.h;
  const r=st==='pill'?Math.min(bh/2,28):8;
  ctx.globalAlpha=w.opacity??1;
  if(st==='raised'){
    // Dégradé simulant une surface bombée
    const gr=ctx.createLinearGradient(x,y,x,y+bh);
    gr.addColorStop(0,c+'28');gr.addColorStop(0.45,bg);gr.addColorStop(1,'rgba(0,0,0,0.35)');
    ctx.fillStyle=gr;rr(ctx,x,y,bw,bh,r);ctx.fill();
    ctx.strokeStyle=c+'90';ctx.lineWidth=1.5;rr(ctx,x,y,bw,bh,r);ctx.stroke();
    _bevel3d(x,y,bw,bh,r,7);
  } else if(st==='neon'){
    ctx.shadowColor=c;ctx.shadowBlur=14;
    ctx.fillStyle=bg;rr(ctx,x,y,bw,bh,r);ctx.fill();
    ctx.strokeStyle=c;ctx.lineWidth=2;rr(ctx,x,y,bw,bh,r);ctx.stroke();
    ctx.shadowBlur=0;
    // Anneau intérieur néon
    ctx.strokeStyle=c+'35';ctx.lineWidth=5;rr(ctx,x+4,y+4,bw-8,bh-8,Math.max(2,r-4));ctx.stroke();
    // Reflet haut
    const hl=ctx.createLinearGradient(x,y,x,y+bh*0.4);
    hl.addColorStop(0,'rgba(255,255,255,0.12)');hl.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=hl;rr(ctx,x+2,y+2,bw-4,bh/2,r);ctx.fill();
  } else if(st==='industrial'){
    // Corps métallique brossé
    const mg=ctx.createLinearGradient(x,y,x,y+bh);
    mg.addColorStop(0,'#4a4a4a');mg.addColorStop(0.3,bg);mg.addColorStop(0.7,bg);mg.addColorStop(1,'#0d0d0d');
    ctx.fillStyle=mg;rr(ctx,x,y,bw,bh,r);ctx.fill();
    ctx.strokeStyle='#606060';ctx.lineWidth=1.5;rr(ctx,x,y,bw,bh,r);ctx.stroke();
    _bevel3d(x,y,bw,bh,r,6);
    // 4 rivets aux coins
    [[x+9,y+9],[x+bw-9,y+9],[x+bw-9,y+bh-9],[x+9,y+bh-9]].forEach(([rx2,ry2])=>{
      ctx.beginPath();ctx.arc(rx2,ry2,3.5,0,Math.PI*2);ctx.fillStyle='#3a3a3a';ctx.fill();
      ctx.beginPath();ctx.arc(rx2,ry2,3.5,0,Math.PI*2);ctx.strokeStyle='#666';ctx.lineWidth=0.8;ctx.stroke();
      ctx.beginPath();ctx.arc(rx2-1,ry2-1,1.2,0,Math.PI*2);ctx.fillStyle='#bbb';ctx.fill();
    });
  } else if(st==='pill'){
    // Fond dégradé pill
    const pg=ctx.createLinearGradient(x,y,x,y+bh);
    pg.addColorStop(0,c+'30');pg.addColorStop(1,bg);
    ctx.fillStyle=pg;rr(ctx,x,y,bw,bh,r);ctx.fill();
    ctx.strokeStyle=c;ctx.lineWidth=1.5;rr(ctx,x,y,bw,bh,r);ctx.stroke();
    // Reflet lentille
    const ll=ctx.createLinearGradient(x,y,x,y+bh*0.5);
    ll.addColorStop(0,'rgba(255,255,255,0.18)');ll.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=ll;rr(ctx,x+3,y+3,bw-6,bh*0.5,r-3);ctx.fill();
  } else { // flat (défaut)
    ctx.fillStyle=bg;rr(ctx,x,y,bw,bh,r);ctx.fill();
    ctx.strokeStyle=c;ctx.lineWidth=1.5;rr(ctx,x,y,bw,bh,r);ctx.stroke();
  }
  ctx.fillStyle=c;ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(w.label||'Action',x+bw/2,y+bh/2);
  ctx.globalAlpha=1;
  if(!editMode)hov(w,`<button onclick="doAction('${w.action||''}','${w.varRef||''}')" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;"></button>`,canvasOnly);
}
function rToggle(w,val,canvasOnly){
  const on=!!val, c=w.color||'#bc8cff';
  const st=w.btnStyle||'flat';
  // Fond du widget
  const bgColor=on?(st==='flat'?'#1a0a2a':c+'15'):_bg3();
  ctx.fillStyle=bgColor;rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();
  if(st!=='flat'){ctx.strokeStyle=on?c+'80':'#30363d';ctx.lineWidth=on?1.5:1;rr(ctx,w.x,w.y,w.w,w.h,8);ctx.stroke();}
  ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
  ctx.fillText(w.label||'',w.x+w.w/2,w.y+4);
  const tx=w.x+w.w/2-20,ty=w.y+w.h/2-7,tw=40,th=14,tr=7;
  // Piste du toggle
  const tkG=ctx.createLinearGradient(tx,ty,tx,ty+th);
  tkG.addColorStop(0,'rgba(0,0,0,0.3)');tkG.addColorStop(1,'rgba(255,255,255,0.05)');
  ctx.fillStyle=on?c+'50':_bg4();rr(ctx,tx,ty,tw,th,tr);ctx.fill();
  ctx.fillStyle=tkG;rr(ctx,tx,ty,tw,th,tr);ctx.fill();
  ctx.strokeStyle=on?c+'70':'#30363d';ctx.lineWidth=1;rr(ctx,tx,ty,tw,th,tr);ctx.stroke();
  // Pastille
  const bx=on?tx+tw-8:tx+8, by=ty+th/2;
  const knobR=6;
  // Ombre portée de la pastille
  ctx.shadowColor='rgba(0,0,0,0.5)';ctx.shadowBlur=4;ctx.shadowOffsetY=1;
  ctx.beginPath();ctx.arc(bx,by,knobR,0,Math.PI*2);
  ctx.fillStyle=on?c:'#6e7681';ctx.fill();
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  // Brillance pastille
  const kg=ctx.createRadialGradient(bx-knobR*0.3,by-knobR*0.35,0,bx,by,knobR);
  kg.addColorStop(0,'rgba(255,255,255,0.45)');kg.addColorStop(1,'rgba(255,255,255,0)');
  ctx.beginPath();ctx.arc(bx,by,knobR,0,Math.PI*2);ctx.fillStyle=kg;ctx.fill();
  if(!editMode)hov(w,`<button onclick="writeDV('${w.varRef}',${on?0:1})" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;"></button>`,canvasOnly);
}
// ── Bouton poussoir DV (momentané : appui=1, relâche=0) ─────────────────────
function rDvPush(w,val,canvasOnly){
  const on=!!val;
  const c=on?(w.color||'#f0883e'):(w.colorOff||'#484f58');
  const bg=on?c+'28':'#0d1117';
  ctx.fillStyle=bg; rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle=c; ctx.lineWidth=on?2:1.5;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();
  if(on){ ctx.shadowColor=c; ctx.shadowBlur=12; ctx.strokeStyle=c+'80'; ctx.lineWidth=3; rr(ctx,w.x+3,w.y+3,w.w-6,w.h-6,8); ctx.stroke(); ctx.shadowBlur=0; }
  const cx2=w.x+w.w/2, cy2=w.y+w.h/2-6;
  ctx.beginPath(); ctx.arc(cx2,cy2,10,0,Math.PI*2); ctx.fillStyle=on?c:c+'40'; ctx.fill();
  if(on){ ctx.beginPath(); ctx.arc(cx2,cy2,14,0,Math.PI*2); ctx.strokeStyle=c+'60'; ctx.lineWidth=3; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(cx2-3,cy2-3,4,0,Math.PI*2); ctx.fillStyle=on?'#ffffff50':'#ffffff20'; ctx.fill();
  ctx.fillStyle=on?c:'#8b949e'; ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText(w.label||'BP', w.x+w.w/2, w.y+w.h-16);
  ctx.fillStyle='#484f58'; ctx.font='8px monospace'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText('DV:'+w.varRef, w.x+w.w-5, w.y+4);
  if(!editMode) hov(w,`<button onmousedown="writeDV('${w.varRef}',true)" onmouseup="writeDV('${w.varRef}',false)" onmouseleave="writeDV('${w.varRef}',false)" ontouchstart="writeDV('${w.varRef}',true)" ontouchend="writeDV('${w.varRef}',false)" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;" title="Maintenir = actif · Relâcher = inactif"></button>`,canvasOnly);
}

// ── Interrupteur DV nommé (toggle persistant) ───────────────────────────────
function rDvToggle(w,val,canvasOnly){
  const on=!!val;
  const c=on?(w.color||'#56d364'):(w.colorOff||'#484f58');
  const bg=on?c+'18':_bg3();
  ctx.fillStyle=bg; rr(ctx,w.x,w.y,w.w,w.h,8); ctx.fill();
  ctx.strokeStyle=c+(on?'':'60'); ctx.lineWidth=on?2:1; rr(ctx,w.x,w.y,w.w,w.h,8); ctx.stroke();
  ctx.fillStyle=_t2(); ctx.font='10px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(w.label||'', w.x+8, w.y+6);
  ctx.fillStyle='#484f58'; ctx.font='8px monospace'; ctx.textAlign='right'; ctx.textBaseline='top';
  ctx.fillText('DV:'+w.varRef, w.x+w.w-5, w.y+6);
  const tw2=44,th2=14,tx2=w.x+w.w/2-22,ty2=w.y+w.h/2-3;
  ctx.fillStyle=on?c+'50':_bg4(); rr(ctx,tx2,ty2,tw2,th2,7); ctx.fill();
  ctx.strokeStyle=c+(on?'':'40'); ctx.lineWidth=1; rr(ctx,tx2,ty2,tw2,th2,7); ctx.stroke();
  const bx2=on?tx2+tw2-10:tx2+3, by2=ty2+th2/2;
  ctx.beginPath(); ctx.arc(bx2+4,by2,6,0,Math.PI*2); ctx.fillStyle=on?c:'#6e7681'; ctx.fill();
  ctx.fillStyle=c; ctx.font='bold 10px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText(on?(w.onLabel||'ACTIF'):(w.offLabel||'inactif'), w.x+w.w/2, w.y+w.h-14);
  if(!editMode) hov(w,`<button onclick="writeDV('${w.varRef}',${on?0:1})" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;"></button>`,canvasOnly);
}


// ══════════════════════════════════════════════════════════════════════════════
// ═══ WIDGETS CARTE MINIMALISTE (fond blanc, style LCD) ═══════════════════════
// ══════════════════════════════════════════════════════════════════════════════

function rTempCard(w, val){
  const bgCard  = w.bgCard  || '#ffffff';
  const txtClr  = w.textColor || '#1a1a2e';
  const al = val!=null && (val>(w.alarmHigh??85) || val<(w.alarmLow??3));
  const accentClr = al ? '#e53935' : (w.color || '#e53935');
  const x=w.x, y=w.y, bw=w.w, bh=w.h;

  // Ombre portée légère
  ctx.shadowColor='rgba(0,0,0,0.18)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
  ctx.fillStyle=bgCard; rr(ctx,x,y,bw,bh,6); ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Bandeau couleur en haut (4px)
  ctx.fillStyle=accentClr; rr(ctx,x,y,bw,4,0); ctx.fill();

  // Bord fin
  ctx.strokeStyle=al?'#e53935':'#e0e0e0'; ctx.lineWidth=1;
  rr(ctx,x,y,bw,bh,6); ctx.stroke();

  // Label
  ctx.fillStyle=al?'#e53935':'#757575';
  ctx.font='10px "Segoe UI",sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='top';
  const lbl=(w.label||'Température').substring(0,18);
  ctx.fillText(lbl, x+8, y+10);

  // Icône thermomètre (petit, coin droit)
  ctx.font='12px sans-serif'; ctx.textAlign='right';
  ctx.fillText('🌡', x+bw-6, y+8);

  // Valeur principale
  const valStr = val!=null && !isNaN(val) ? parseFloat(val).toFixed(1) : '– –';
  const unit   = w.unit||'°C';
  const fontSize = bh>60 ? 26 : 20;
  ctx.fillStyle = accentClr;
  ctx.font = `bold ${fontSize}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(valStr, x+bw/2-10, y+bh*0.62);

  // Unité
  ctx.fillStyle='#9e9e9e'; ctx.font=`bold 11px "Segoe UI",sans-serif`;
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(unit, x+bw/2+Math.ceil(ctx.measureText(valStr).width/2)+2, y+bh*0.62);

  // Alarme badge
  if(al){
    ctx.fillStyle='#e53935';
    ctx.font='bold 9px sans-serif'; ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText('⚠ ALARME', x+bw-6, y+bh-4);
  } else if(val!=null){
    ctx.fillStyle='#bdbdbd'; ctx.font='8px sans-serif';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText(`↑${w.alarmHigh??85}  ↓${w.alarmLow??3}`, x+bw-6, y+bh-4);
  }
}

function rSpCard(w, val, canvasOnly){
  const bgCard  = w.bgCard  || '#ffffff';
  const accentClr = w.color || '#1565c0';
  const x=w.x, y=w.y, bw=w.w, bh=w.h;

  // Ombre portée
  ctx.shadowColor='rgba(0,0,0,0.18)'; ctx.shadowBlur=6; ctx.shadowOffsetY=2;
  ctx.fillStyle=bgCard; rr(ctx,x,y,bw,bh,6); ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Bandeau couleur gauche (4px)
  ctx.fillStyle=accentClr; rr(ctx,x,y,4,bh,0); ctx.fill();

  // Bord fin
  ctx.strokeStyle='#e0e0e0'; ctx.lineWidth=1;
  rr(ctx,x,y,bw,bh,6); ctx.stroke();

  // Icône cible
  ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText('🎯', x+10, y+7);

  // Label
  ctx.fillStyle='#757575';
  ctx.font='10px "Segoe UI",sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText((w.label||'Consigne').substring(0,18), x+28, y+9);

  // Valeur
  const valStr = val!=null && !isNaN(val) ? parseFloat(val).toFixed(1) : '– –';
  const unit   = w.unit||'°C';
  ctx.fillStyle=accentClr;
  ctx.font=`bold 24px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(valStr, x+bw/2-8, y+bh*0.52);
  ctx.fillStyle='#9e9e9e'; ctx.font='bold 11px "Segoe UI",sans-serif';
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(unit, x+bw/2+Math.ceil(ctx.measureText(valStr).width/2)+2, y+bh*0.52);

  // Barre de progression (statique, pas de slider)
  const slx=x+10, sly=y+bh-12, slw=bw-20, slh=3;
  ctx.fillStyle='#e0e0e0'; rr(ctx,slx,sly,slw,slh,2); ctx.fill();
  if(val!=null){
    const mn=w.min||0, mx2=w.max||100;
    const p=Math.min(1,Math.max(0,(parseFloat(val)-mn)/(mx2-mn)));
    ctx.fillStyle=accentClr; rr(ctx,slx,sly,slw*p,slh,2); ctx.fill();
  }
  // Icône crayon cliquable
  if(!editMode){
    ctx.fillStyle=accentClr+'90'; ctx.font='10px sans-serif';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText('✎',x+bw-8,y+bh-14);
  }

  if(!editMode){
    hov(w,`<div onclick="_spEdit('${w.id}','${w.varRef}',${val!=null?parseFloat(val):(w.min||0)},${w.min||0},${w.max||100},${w.step||0.5},'${unit}','${accentClr}')" style="position:absolute;inset:0;cursor:text;border-radius:6px;"></div>`,canvasOnly);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ═══ WIDGETS 3D INDUSTRIELS ═══════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════

// Cercle avec dégradé 3D (helper)
function _circle3d(cx,cy,r,baseColor,pressed){
  // Ombre portée
  ctx.shadowColor='rgba(0,0,0,0.45)';
  ctx.shadowBlur=pressed?3:8;
  ctx.shadowOffsetY=pressed?1:4;
  // Corps principal avec dégradé sphérique
  const g=ctx.createRadialGradient(cx-r*0.3,cy-r*0.35,r*0.05,cx,cy,r);
  if(pressed){
    g.addColorStop(0, _shadeColor(baseColor,20));
    g.addColorStop(0.6, baseColor);
    g.addColorStop(1, _shadeColor(baseColor,-40));
  } else {
    g.addColorStop(0, _shadeColor(baseColor,55));
    g.addColorStop(0.4, _shadeColor(baseColor,15));
    g.addColorStop(0.8, baseColor);
    g.addColorStop(1, _shadeColor(baseColor,-50));
  }
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
  ctx.fillStyle=g; ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;
  // Reflet spéculaire
  if(!pressed){
    const hl=ctx.createRadialGradient(cx-r*0.28,cy-r*0.32,0,cx-r*0.15,cy-r*0.2,r*0.55);
    hl.addColorStop(0,'rgba(255,255,255,0.55)');
    hl.addColorStop(1,'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle=hl; ctx.fill();
  }
}

function _shadeColor(hex,pct){
  // Eclaircit ou assombrit une couleur hex de pct%
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  r=Math.min(255,Math.max(0,Math.round(r*(1+pct/100))));
  g=Math.min(255,Math.max(0,Math.round(g*(1+pct/100))));
  b=Math.min(255,Math.max(0,Math.round(b*(1+pct/100))));
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

// Bouton poussoir industriel 3D (champignon)
// ── Popup saisie directe pour widgets consigne (setpoint / sp_card) ──────────
// Appelé au clic sur le widget — ouvre un overlay de saisie centré sur le widget
function _spEdit(wid, varRef, curVal, mn, mx, step, unit, color){
  // Supprimer tout popup existant
  const old=document.getElementById('_sp_overlay');
  if(old) old.remove();

  const ov=document.createElement('div');
  ov.id='_sp_overlay';
  ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
  ov.innerHTML=`
    <div style="background:#161b22;border:2px solid ${color};border-radius:14px;padding:20px 24px;
                min-width:200px;max-width:280px;box-shadow:0 12px 40px rgba(0,0,0,0.7);text-align:center;">
      <div style="color:${color};font:bold 13px sans-serif;margin-bottom:12px;">✎ Saisie consigne</div>
      <input id="_sp_input" type="number" min="${mn}" max="${mx}" step="${step}" value="${curVal.toFixed ? curVal.toFixed(2) : curVal}"
        style="width:100%;background:#0d1117;border:2px solid ${color}88;border-radius:8px;
               color:${color};font:bold 22px monospace;padding:8px 12px;outline:none;
               text-align:center;-moz-appearance:textfield;">
      <div style="color:#8b949e;font:10px sans-serif;margin:6px 0 14px;">
        Min ${mn} — Max ${mx} ${unit}
      </div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button onclick="(()=>{const v=parseFloat(document.getElementById('_sp_input').value);if(!isNaN(v)&&v>=${mn}&&v<=${mx}){writeVar('${varRef}',v);document.getElementById('_sp_overlay').remove();setTimeout(()=>document.body.focus(),0);}else{document.getElementById('_sp_input').style.borderColor='#f85149';}})()"
          style="flex:1;background:${color}22;border:2px solid ${color};border-radius:8px;
                 color:${color};font:bold 13px sans-serif;padding:8px 16px;cursor:pointer;">
          ✓ Valider
        </button>
        <button onclick="(()=>{document.getElementById('_sp_overlay').remove();setTimeout(()=>document.body.focus(),0);})()"
          style="background:#21262d;border:1px solid #30363d;border-radius:8px;
                 color:#8b949e;font:bold 13px sans-serif;padding:8px 14px;cursor:pointer;">
          ✕
        </button>
      </div>
    </div>`;
  // Fermer si clic hors du panneau
  ov.addEventListener('click', e=>{ if(e.target===ov){ ov.remove(); setTimeout(()=>document.body.focus(),0); } });
  document.body.appendChild(ov);
  // Focus + sélection automatique
  const inp=document.getElementById('_sp_input');
  if(inp){ inp.focus(); inp.select();
    inp.addEventListener('keydown', e=>{
      if(e.key==='Enter'){
        const v=parseFloat(inp.value);
        if(!isNaN(v)&&v>=mn&&v<=mx){ writeVar(varRef,v); ov.remove(); setTimeout(()=>document.body.focus(),0); }
        else { inp.style.borderColor='#f85149'; }
      } else if(e.key==='Escape'){ ov.remove(); setTimeout(()=>document.body.focus(),0); }
    });
  }
}

// ── Bouton poussoir 3D bascule (toggle au clic — ON/OFF) ─────────────────────
function rToggleBtn3d(w, val, canvasOnly){
  const on=!!val;
  const baseColor = on ? (w.color||'#22c55e') : (w.colorOff||'#374151');
  const ledColor  = w.color||'#22c55e';
  const x=w.x, y=w.y, bw=w.w, bh=w.h;
  const cx=x+bw/2, cy=y+bh/2-8;
  const ringR = Math.min(bw,bh)*0.42;
  const btnR  = ringR*0.72;

  // Anneau métallique
  const ringG=ctx.createRadialGradient(cx-ringR*0.2,cy-ringR*0.2,ringR*0.1,cx,cy,ringR);
  ringG.addColorStop(0,'#9ca3af'); ringG.addColorStop(0.5,'#6b7280');
  ringG.addColorStop(0.8,'#374151'); ringG.addColorStop(1,'#1f2937');
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=8; ctx.shadowOffsetY=3;
  ctx.beginPath(); ctx.arc(cx,cy,ringR,0,Math.PI*2);
  ctx.fillStyle=ringG; ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Reflet anneau
  const ringHl=ctx.createLinearGradient(cx-ringR,cy-ringR,cx+ringR,cy+ringR);
  ringHl.addColorStop(0,'rgba(255,255,255,0.35)'); ringHl.addColorStop(0.5,'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(cx,cy,ringR,0,Math.PI*2); ctx.fillStyle=ringHl; ctx.fill();

  // Bouton sphérique 3D (enfoncé si ON)
  _circle3d(cx, cy, btnR, baseColor, on);

  // LED voyant
  const ledX=cx+btnR*0.55, ledY=cy-btnR*0.55, ledR=Math.max(3,btnR*0.18);
  ctx.beginPath(); ctx.arc(ledX,ledY,ledR,0,Math.PI*2);
  ctx.fillStyle=on?ledColor:'#1f2937'; ctx.fill();
  if(on){
    ctx.shadowColor=ledColor; ctx.shadowBlur=6;
    ctx.beginPath(); ctx.arc(ledX,ledY,ledR,0,Math.PI*2);
    ctx.strokeStyle=ledColor+'90'; ctx.lineWidth=2; ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Label
  const lblY=y+bh-10;
  ctx.fillStyle='#e5e7eb';
  ctx.font=`bold ${Math.min(11,bh*0.14)}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(w.label||'', cx, lblY);

  // État ON/OFF sous le label
  ctx.fillStyle=on?ledColor:'#6b7280';
  ctx.font=`${Math.min(9,bh*0.12)}px "Segoe UI",sans-serif`;
  ctx.textBaseline='top';
  ctx.fillText(on?(w.onLabel||'ON'):(w.offLabel||'OFF'), cx, lblY+1);

  if(!editMode){
    // Clic → bascule (toggle) DV — pas de maintien nécessaire
    hov(w,`<button onclick="writeDV('${w.varRef}',${on?0:1})" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;border-radius:50%;" title="${on?(w.onLabel||'ON → clic pour OFF'):(w.offLabel||'OFF → clic pour ON')}"></button>`,canvasOnly);
  }
}

function rPush3d(w, val, canvasOnly){
  const on=!!val;
  const baseColor = on ? (w.color||'#22c55e') : (w.colorOff||'#374151');
  const ledColor  = w.color||'#22c55e';
  const x=w.x, y=w.y, bw=w.w, bh=w.h;
  const cx=x+bw/2, cy=y+bh/2-8;
  const ringR = Math.min(bw,bh)*0.42;
  const btnR  = ringR*0.72;

  // Anneau métallique (embase)
  const ringG=ctx.createRadialGradient(cx-ringR*0.2,cy-ringR*0.2,ringR*0.1,cx,cy,ringR);
  ringG.addColorStop(0,'#9ca3af');
  ringG.addColorStop(0.5,'#6b7280');
  ringG.addColorStop(0.8,'#374151');
  ringG.addColorStop(1,'#1f2937');
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=8; ctx.shadowOffsetY=3;
  ctx.beginPath(); ctx.arc(cx,cy,ringR,0,Math.PI*2);
  ctx.fillStyle=ringG; ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Reflet anneau
  const ringHl=ctx.createLinearGradient(cx-ringR,cy-ringR,cx+ringR,cy+ringR);
  ringHl.addColorStop(0,'rgba(255,255,255,0.35)');
  ringHl.addColorStop(0.5,'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(cx,cy,ringR,0,Math.PI*2);
  ctx.fillStyle=ringHl; ctx.fill();

  // Bouton sphérique 3D
  _circle3d(cx, cy, btnR, baseColor, on);

  // LED voyant (petit rond en haut du bouton)
  const ledX=cx+btnR*0.55, ledY=cy-btnR*0.55, ledR=Math.max(3,btnR*0.18);
  ctx.beginPath(); ctx.arc(ledX,ledY,ledR,0,Math.PI*2);
  ctx.fillStyle=on?ledColor:'#1f2937'; ctx.fill();
  if(on){
    ctx.shadowColor=ledColor; ctx.shadowBlur=6;
    ctx.beginPath(); ctx.arc(ledX,ledY,ledR,0,Math.PI*2);
    ctx.strokeStyle=ledColor+'90'; ctx.lineWidth=2; ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Label sous le bouton
  const lblY = y+bh-10;
  ctx.fillStyle='#e5e7eb';
  ctx.font=`bold ${Math.min(11,bh*0.14)}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(w.label||'', cx, lblY);

  if(!editMode){
    if(w.momentary!==false){
      hov(w,`<button onmousedown="writeDV('${w.varRef}',true)" onmouseup="writeDV('${w.varRef}',false)" onmouseleave="writeDV('${w.varRef}',false)" ontouchstart="writeDV('${w.varRef}',true)" ontouchend="writeDV('${w.varRef}',false)" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;-webkit-tap-highlight-color:transparent;" title="${w.label||''}"></button>`,canvasOnly);
    } else {
      hov(w,`<button onclick="writeDV('${w.varRef}',${on?0:1})" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;" title="${w.label||''}"></button>`,canvasOnly);
    }
  }
}

// Interrupteur à bascule 3D (style industriel)
function rToggle3d(w, val, canvasOnly){
  const on=!!val;
  const accentClr = w.color||'#3b82f6';
  const offClr    = w.colorOff||'#374151';
  const x=w.x, y=w.y, bw=w.w, bh=w.h;

  // Boîtier principal (fond gris métal)
  const boxG=ctx.createLinearGradient(x,y,x,y+bh);
  boxG.addColorStop(0,'#6b7280');
  boxG.addColorStop(0.4,'#4b5563');
  boxG.addColorStop(1,'#1f2937');
  ctx.shadowColor='rgba(0,0,0,0.4)'; ctx.shadowBlur=7; ctx.shadowOffsetY=3;
  rr(ctx,x,y,bw,bh,10); ctx.fillStyle=boxG; ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Reflet haut
  const topHl=ctx.createLinearGradient(x,y,x,y+bh*0.4);
  topHl.addColorStop(0,'rgba(255,255,255,0.22)');
  topHl.addColorStop(1,'rgba(255,255,255,0)');
  rr(ctx,x,y,bw,bh,10); ctx.fillStyle=topHl; ctx.fill();

  // Bord fin
  ctx.strokeStyle='#9ca3af40'; ctx.lineWidth=1;
  rr(ctx,x,y,bw,bh,10); ctx.stroke();

  // Glissière du toggle (intérieure enfoncée)
  const tw=bw*0.62, th=bh*0.36;
  const tx=x+(bw-tw)/2, ty=y+(bh-th)/2+2;
  ctx.fillStyle=on?accentClr+'30':'#111827';
  rr(ctx,tx,ty,tw,th,th/2); ctx.fill();
  ctx.strokeStyle=on?accentClr+'60':'#374151';
  ctx.lineWidth=1; rr(ctx,tx,ty,tw,th,th/2); ctx.stroke();

  // Pastille coulissante 3D
  const knobR=th*0.55;
  const knobX = on ? tx+tw-knobR-2 : tx+knobR+2;
  const knobY = ty+th/2;
  _circle3d(knobX, knobY, knobR, on?accentClr:offClr, false);

  // Texte ON / OFF
  const lblOn  = w.onLabel  || 'ON';
  const lblOff = w.offLabel || 'OFF';
  ctx.font=`bold ${Math.min(10,bh*0.2)}px "Segoe UI",sans-serif`;
  ctx.textBaseline='bottom';
  if(on){
    ctx.fillStyle=accentClr; ctx.textAlign='left';
    ctx.fillText(lblOn, tx+4, ty-2);
  } else {
    ctx.fillStyle='#9ca3af'; ctx.textAlign='right';
    ctx.fillText(lblOff, tx+tw-4, ty-2);
  }

  // Label principal
  ctx.fillStyle='#d1d5db';
  ctx.font=`${Math.min(10,bh*0.18)}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(w.label||'', x+bw/2, y+bh-3);

  if(!editMode){
    hov(w,`<button onclick="writeDV('${w.varRef}',${on?0:1})" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;" title="${on?(w.onLabel||'ON'):(w.offLabel||'OFF')}"></button>`,canvasOnly);
  }
}

// Bouton action 3D (style plastique moulé)
function rBtn3d(w, canvasOnly){
  const accentClr = w.color||'#3b82f6';
  const bgClr     = w.bg   ||'#1e3a5f';
  const x=w.x, y=w.y, bw=w.w, bh=w.h;
  const r=10;

  // Corps avec dégradé 3D
  const mainG=ctx.createLinearGradient(x,y,x,y+bh);
  mainG.addColorStop(0, _shadeColor(accentClr, 40));
  mainG.addColorStop(0.3, accentClr);
  mainG.addColorStop(0.7, _shadeColor(accentClr,-15));
  mainG.addColorStop(1, _shadeColor(accentClr,-40));
  ctx.shadowColor='rgba(0,0,0,0.5)'; ctx.shadowBlur=8; ctx.shadowOffsetY=4;
  rr(ctx,x,y,bw,bh,r); ctx.fillStyle=mainG; ctx.fill();
  ctx.shadowBlur=0; ctx.shadowOffsetY=0;

  // Biseau haut lumineux
  const topG=ctx.createLinearGradient(x,y,x,y+bh*0.45);
  topG.addColorStop(0,'rgba(255,255,255,0.28)');
  topG.addColorStop(1,'rgba(255,255,255,0)');
  rr(ctx,x+2,y+2,bw-4,bh*0.5,r-2); ctx.fillStyle=topG; ctx.fill();

  // Biseau bas ombre
  const botG=ctx.createLinearGradient(x,y+bh*0.55,x,y+bh);
  botG.addColorStop(0,'rgba(0,0,0,0)');
  botG.addColorStop(1,'rgba(0,0,0,0.35)');
  rr(ctx,x+2,y+bh*0.5,bw-4,bh*0.5-2,r-2); ctx.fillStyle=botG; ctx.fill();

  // Bord
  ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1;
  rr(ctx,x,y,bw,bh,r); ctx.stroke();
  ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1;
  rr(ctx,x+1,y+1,bw-2,bh-2,r-1); ctx.stroke();

  // Texte
  ctx.fillStyle='#ffffff';
  ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=3;
  ctx.font=`bold ${Math.min(13,bh*0.3)}px "Segoe UI",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(w.label||'Action', x+bw/2, y+bh/2);
  ctx.shadowBlur=0;

  if(!editMode){
    hov(w,`<button onclick="doAction('${w.action||''}','${w.varRef||''}')" style="position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;cursor:pointer;" title="${w.label||''}"></button>`,canvasOnly);
  }
}

function rCntDisplay(w){
  const c=w.color||'#50ff50';
  const bid=w.blockId||'';
  const starts =bid?(getCnt(bid,'starts')??null):null;
  const total  =bid?(getCnt(bid,'total')??null):null;
  const runtime=bid?(getCnt(bid,'runtime')??null):null;
  ctx.fillStyle=_bg3();rr(ctx,w.x,w.y,w.w,w.h,10);ctx.fill();
  ctx.strokeStyle=c+'60';ctx.lineWidth=1.5;rr(ctx,w.x,w.y,w.w,w.h,10);ctx.stroke();
  ctx.fillStyle=_t2();ctx.font='10px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(w.label||'Compteur',w.x+9,w.y+6);
  ctx.fillStyle='#484f58';ctx.font='8px monospace';ctx.textAlign='right';
  ctx.fillText(bid?'⏱ '+bid:'— non lié —',w.x+w.w-6,w.y+6);
  const rows=[];
  if(w.showStarts!==false) rows.push({label:'Démarrages',val:starts!=null?Math.round(starts)+'':'—',unit:''});
  if(w.showTotal!==false)  rows.push({label:'Total',val:total!=null?total.toFixed(2):'—',unit:'h'});
  if(w.showRuntime!==false)rows.push({label:'Session',val:runtime!=null?runtime.toFixed(1):'—',unit:'s'});
  const rowH=Math.floor((w.h-22)/Math.max(rows.length,1));
  rows.forEach((r,i)=>{
    const ry=w.y+20+i*rowH;
    if(i%2===0){ctx.fillStyle=c+'10';ctx.fillRect(w.x+4,ry,w.w-8,rowH-1);}
    ctx.fillStyle=_t2();ctx.font='9px sans-serif';ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(r.label,w.x+9,ry+rowH/2);
    ctx.fillStyle=c;ctx.font='bold 13px monospace';ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(r.val+(r.unit?' '+r.unit:''),w.x+w.w-8,ry+rowH/2);
  });
}
function rLabel(w){
  // Fond optionnel avec dégradé (si bg ou gradientColor2 défini)
  if(w.bg||w.gradientColor2){
    ctx.globalAlpha=w.opacity??1;
    ctx.fillStyle=_mkGrad({fill:w.bg||'transparent',gradientColor2:w.gradientColor2||'',gradientDir:w.gradientDir||'horizontal'},w.x,w.y,w.w,w.h);
    rr(ctx,w.x,w.y,w.w,w.h,w.radius||4);ctx.fill();
    ctx.globalAlpha=1;
  }
  // Texte centré sur le bounding-box → rotation canvas correcte
  const align=w.align||'center';
  const tx=align==='right'?w.x+w.w:align==='left'?w.x:w.x+w.w/2;
  ctx.fillStyle=w.color||'#e6edf3';
  ctx.font=`${w.bold?'bold ':''}${w.fontSize||14}px sans-serif`;
  ctx.textAlign=align;ctx.textBaseline='middle';
  ctx.fillText(w.text||'Texte',tx,w.y+w.h/2);
}

// ── Texte dynamique (dyn_text) — affiche une valeur PLC sous forme de texte formaté ──
function rDynText(w, val){
  // Fond optionnel
  if(w.bg){
    ctx.globalAlpha=w.opacity??1;
    ctx.fillStyle=w.bg;
    rr(ctx,w.x,w.y,w.w,w.h,w.radius||4);ctx.fill();
    ctx.globalAlpha=1;
  }
  // Étiquette (optionnelle, petite, gris)
  if(w.label){
    ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';
    ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText(w.label,w.x+4,w.y+2);
  }
  // Valeur formatée
  let txt='—';
  if(val!==null&&val!==undefined){
    // Dictionnaire de mappage ex: "0:Arrêt,1:Marche,2:Erreur"
    const mapStr=w.map||'';
    if(mapStr){
      const entries=mapStr.split(',');
      let mapped=null;
      for(const e of entries){const p=e.split(':');if(p.length===2&&parseFloat(p[0])===parseFloat(val)){mapped=p[1].trim();break;}}
      if(mapped!==null){txt=mapped;}
      else{txt=isNaN(parseFloat(val))?String(val):parseFloat(val).toFixed(w.decimals??1);}
    } else {
      txt=isNaN(parseFloat(val))?String(val):parseFloat(val).toFixed(w.decimals??1);
    }
    const pre=w.prefix||''; const suf=w.suffix||'';
    txt=pre+txt+suf;
  }
  const align=w.align||'left';
  const labelOffset=(w.label)?13:0;
  const cy=w.y+labelOffset+(w.h-labelOffset)/2;
  const tx=align==='right'?w.x+w.w-4:align==='center'?w.x+w.w/2:w.x+4;
  ctx.fillStyle=w.color||'#e6edf3';
  ctx.font=`${w.bold?'bold ':''}${w.fontSize||16}px sans-serif`;
  ctx.textAlign=align;ctx.textBaseline='middle';
  ctx.fillText(txt,tx,cy);
  // Indicateur de source (mode édition) - petit badge en bas droite
  if(editMode&&w.varRef){
    ctx.fillStyle='#484f58';ctx.font='8px sans-serif';
    ctx.textAlign='right';ctx.textBaseline='bottom';
    ctx.fillText(w.varRef,w.x+w.w-3,w.y+w.h-2);
  }
}
function rRect(w){ctx.globalAlpha=w.opacity??1;ctx.fillStyle=_mkGrad({fill:w.bg||_bg2(),gradientColor2:w.gradientColor2||'',gradientDir:w.gradientDir||'vertical'},w.x,w.y,w.w,w.h);rr(ctx,w.x,w.y,w.w,w.h,w.radius||8);ctx.fill();if(w.color){ctx.strokeStyle=w.color;ctx.lineWidth=w.borderWidth||1;ctx.stroke();}_bevel3d(w.x,w.y,w.w,w.h,w.radius||8,w.bevel||0);ctx.globalAlpha=1;if(w.label){ctx.fillStyle=_t2();ctx.font='11px sans-serif';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(w.label,w.x+9,w.y+7);}}
function rPipe(w){const c=w.color||'#58a6ff',th=w.thickness||8;ctx.strokeStyle=c;ctx.lineWidth=th;ctx.lineCap='round';if(w.horizontal!==false){ctx.beginPath();ctx.moveTo(w.x,w.y+w.h/2);ctx.lineTo(w.x+w.w,w.y+w.h/2);ctx.stroke();ctx.fillStyle=c;const mx=w.x+w.w/2,my=w.y+w.h/2;ctx.beginPath();ctx.moveTo(mx+7,my);ctx.lineTo(mx-5,my-5);ctx.lineTo(mx-5,my+5);ctx.closePath();ctx.fill();}else{ctx.beginPath();ctx.moveTo(w.x+w.w/2,w.y);ctx.lineTo(w.x+w.w/2,w.y+w.h);ctx.stroke();}}

// ── Helpers biseautage 3D ────────────────────────────────────────────────────
// Applique un bord biseauté (effet relief) sur un rect arrondi
function _bevel3d(x,y,w,h,r,b){
  if(!b||b<=0)return;
  const bw=Math.max(1.5,b*0.6), a=Math.min(0.55,b*0.065);
  // off = bw entier : le trait (largeur bw, centré sur rr inset) ne touche jamais le bord
  const off=bw;
  const ri=Math.max(0,Math.min(r-off,(w-off*2)/2,(h-off*2)/2));
  // Clip inset de bw/2 → le demi-trait extérieur est masqué, plus de liseré
  const ci=bw*0.5, cr=Math.max(0,r-ci);
  ctx.save();
  rr(ctx,x+ci,y+ci,w-ci*2,h-ci*2,cr); ctx.clip();
  // ── Reflet haut-gauche ──
  ctx.save();
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.lineTo(x,y+h); ctx.closePath(); ctx.clip();
  ctx.strokeStyle=`rgba(255,255,255,${a})`; ctx.lineWidth=bw; ctx.lineCap='round';
  rr(ctx,x+off,y+off,w-off*2,h-off*2,ri); ctx.stroke();
  ctx.restore();
  // ── Ombre bas-droite ──
  ctx.save();
  ctx.beginPath(); ctx.moveTo(x+w,y+h); ctx.lineTo(x+w,y); ctx.lineTo(x,y+h); ctx.closePath(); ctx.clip();
  ctx.strokeStyle=`rgba(0,0,0,${Math.min(0.6,b*0.085)})`; ctx.lineWidth=bw; ctx.lineCap='round';
  rr(ctx,x+off,y+off,w-off*2,h-off*2,ri); ctx.stroke();
  ctx.restore();
  ctx.restore();
}
// Biseautage pour ellipse/cercle
function _bevelEllipse(cx,cy,rx,ry,b){
  if(!b||b<=0)return;
  const bw=Math.max(1.5,b*0.65),a=Math.min(0.55,b*0.07);
  ctx.save();ctx.lineWidth=bw;
  const ir=Math.max(1,rx-bw),ij=Math.max(1,ry-bw);
  // Reflet haut-gauche (225°→45°)
  ctx.strokeStyle=`rgba(255,255,255,${a})`;
  ctx.beginPath();ctx.ellipse(cx,cy,ir,ij,0,Math.PI*1.25,Math.PI*0.25);ctx.stroke();
  // Ombre bas-droite (45°→225°)
  ctx.strokeStyle=`rgba(0,0,0,${Math.min(0.6,b*0.09)})`;
  ctx.beginPath();ctx.ellipse(cx,cy,ir,ij,0,Math.PI*0.25,Math.PI*1.25);ctx.stroke();
  ctx.restore();
}
// ── Helper : crée un gradient selon les props du widget ─────────────────────
function _mkGrad(w, x,y,width,height){
  const c1=w.fill||'#1a2f45', c2=w.gradientColor2||'';
  if(!c2) return c1;
  const dir=w.gradientDir||'vertical';
  let g;
  if(dir==='radial'){
    g=ctx.createRadialGradient(x+width/2,y+height/2,0,x+width/2,y+height/2,Math.max(width,height)/2);
  } else if(dir==='horizontal'){
    g=ctx.createLinearGradient(x,y,x+width,y);
  } else { // vertical
    g=ctx.createLinearGradient(x,y,x,y+height);
  }
  g.addColorStop(0,c1);g.addColorStop(1,c2);
  return g;
}
// ── Helper : overlay en mode édition pour les formes de dessin ───────────────
function _drawEditOverlay(w){
  if(!editMode) return;
  const isSel = selected===w;
  const col = isSel ? '#f0883e' : '#58a6ff';
  ctx.save();
  ctx.strokeStyle=col; ctx.lineWidth=isSel?1.5:1;
  ctx.setLineDash([4,3]);
  ctx.strokeRect(w.x-2,w.y-2,w.w+4,w.h+4);
  ctx.setLineDash([]);
  // Badge type
  const badge='✏ '+w.type.replace('draw_','');
  ctx.font='bold 8px sans-serif';
  const bw=ctx.measureText(badge).width+10;
  ctx.fillStyle='rgba(13,31,53,0.82)';ctx.fillRect(w.x+2,w.y+2,bw,14);
  ctx.fillStyle=col;ctx.textAlign='left';ctx.textBaseline='top';
  ctx.fillText(badge,w.x+5,w.y+3);
  // Dimensions
  const dim=`${w.w}×${w.h}`;
  ctx.font='8px sans-serif';
  const dw=ctx.measureText(dim).width+8;
  ctx.fillStyle='rgba(13,31,53,0.82)';ctx.fillRect(w.x+w.w-dw-2,w.y+w.h-14,dw,13);
  ctx.fillStyle='#8b949e';ctx.textAlign='right';ctx.textBaseline='bottom';
  ctx.fillText(dim,w.x+w.w-3,w.y+w.h-2);
  ctx.restore();
  if(isSel) _drawHandles(w,true);
}

function rDrawCircle(w){
  ctx.globalAlpha=w.opacity??1;
  const cx=w.x+w.w/2,cy=w.y+w.h/2,rx=w.w/2,ry=w.h/2;
  ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fillStyle=_mkGrad(w,w.x,w.y,w.w,w.h);ctx.fill();
  if((w.strokeWidth||2)>0&&w.stroke){ctx.strokeStyle=w.stroke;ctx.lineWidth=w.strokeWidth||2;ctx.stroke();}
  _bevelEllipse(cx,cy,rx,ry,w.bevel||0);
  // Brillance interne (spot lumineux haut-gauche)
  if(w.bevel>0){const sg=ctx.createRadialGradient(cx-rx*0.3,cy-ry*0.3,0,cx,cy,Math.max(rx,ry));sg.addColorStop(0,`rgba(255,255,255,${Math.min(0.35,w.bevel*0.04)})`);sg.addColorStop(1,'rgba(255,255,255,0)');ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fillStyle=sg;ctx.fill();}
  ctx.globalAlpha=1;
  if(w.label){ctx.fillStyle='rgba(230,237,243,0.9)';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(w.label,cx,cy);}
  _drawEditOverlay(w);
}

function rDrawEllipse(w){
  ctx.globalAlpha=w.opacity??1;
  const cx=w.x+w.w/2,cy=w.y+w.h/2,rx=w.w/2,ry=w.h/2;
  ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fillStyle=_mkGrad(w,w.x,w.y,w.w,w.h);ctx.fill();
  if((w.strokeWidth||2)>0&&w.stroke){ctx.strokeStyle=w.stroke;ctx.lineWidth=w.strokeWidth||2;ctx.stroke();}
  _bevelEllipse(cx,cy,rx,ry,w.bevel||0);
  if(w.bevel>0){const sg=ctx.createRadialGradient(cx-rx*0.3,cy-ry*0.3,0,cx,cy,Math.max(rx,ry));sg.addColorStop(0,`rgba(255,255,255,${Math.min(0.3,w.bevel*0.035)})`);sg.addColorStop(1,'rgba(255,255,255,0)');ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fillStyle=sg;ctx.fill();}
  ctx.globalAlpha=1;
  if(w.label){ctx.fillStyle='rgba(230,237,243,0.9)';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(w.label,w.x+w.w/2,w.y+w.h/2);}
  _drawEditOverlay(w);
}

function rDrawTriangle(w){
  ctx.globalAlpha=w.opacity??1;
  const cx=w.x+w.w/2;
  ctx.beginPath();ctx.moveTo(cx,w.y);ctx.lineTo(w.x+w.w,w.y+w.h);ctx.lineTo(w.x,w.y+w.h);ctx.closePath();
  ctx.fillStyle=_mkGrad(w,w.x,w.y,w.w,w.h);ctx.fill();
  if((w.strokeWidth||2)>0&&w.stroke){ctx.strokeStyle=w.stroke;ctx.lineWidth=w.strokeWidth||2;ctx.lineJoin='round';ctx.stroke();}
  if(w.bevel>0){
    const b=w.bevel,bw=Math.max(1,b*0.5),a=Math.min(0.55,b*0.07);
    ctx.save();ctx.lineWidth=bw;ctx.lineCap='round';
    // Reflet côté gauche-haut (arête montante gauche)
    ctx.strokeStyle=`rgba(255,255,255,${a})`;
    ctx.beginPath();ctx.moveTo(cx,w.y+bw);ctx.lineTo(w.x+bw,w.y+w.h-bw);ctx.stroke();
    // Ombre bas + côté droit
    ctx.strokeStyle=`rgba(0,0,0,${Math.min(0.55,b*0.08)})`;
    ctx.beginPath();ctx.moveTo(w.x+bw,w.y+w.h-bw*.5);ctx.lineTo(w.x+w.w-bw,w.y+w.h-bw*.5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx,w.y+bw);ctx.lineTo(w.x+w.w-bw,w.y+w.h-bw);ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha=1;
  if(w.label){ctx.fillStyle='rgba(230,237,243,0.9)';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(w.label,cx,w.y+w.h*0.65);}
  _drawEditOverlay(w);
}

function rDrawLine(w){
  // Assurer une hauteur minimum visible en mode édition
  const lh=Math.max(w.h,w.strokeWidth||3);
  ctx.globalAlpha=w.opacity??1;
  const x1=w.x,y1=w.y+lh/2,x2=w.x+w.w,y2=w.y+lh/2;
  ctx.strokeStyle=w.stroke||'#58a6ff';ctx.lineWidth=w.strokeWidth||3;ctx.lineCap='round';
  if((w.lineDash||0)>0){ctx.setLineDash([w.lineDash,w.lineDash]);} else {ctx.setLineDash([]);}
  ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  ctx.setLineDash([]);
  if(w.arrowEnd){
    const ang=Math.atan2(y2-y1,x2-x1);
    const as=(w.strokeWidth||3)*3+6;
    ctx.fillStyle=w.stroke||'#58a6ff';
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-as*Math.cos(ang-0.45),y2-as*Math.sin(ang-0.45));
    ctx.lineTo(x2-as*Math.cos(ang+0.45),y2-as*Math.sin(ang+0.45));
    ctx.closePath();ctx.fill();
  }
  ctx.globalAlpha=1;
  _drawEditOverlay(w);
}
function rAlarm(w,val){const on=!!val,c=on?(w.colorOn||'#f85149'):(w.colorOff||'#484f58'),r=Math.min(w.w,w.h)/2-5,cx=w.x+w.w/2,cy=w.y+w.h/2-6;ctx.fillStyle=c+'20';rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();ctx.fillStyle=c;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();if(on){ctx.strokeStyle=c+'60';ctx.lineWidth=5;ctx.beginPath();ctx.arc(cx,cy,r+4,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='#8b949e';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(w.label||'',cx,w.y+w.h-2);}

// ── Rendu symbole SVG (via blob URL + cache) ──────────────────────────
function rSym(w,val){
  const sym=_findSym(w.symId);
  if(!sym){ctx.fillStyle=_bg4();rr(ctx,w.x,w.y,w.w,w.h,6);ctx.fill();ctx.fillStyle=_t2();ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(w.symId||'?',w.x+w.w/2,w.y+w.h/2);return;}
  const on=w.varRef?!!val:true;
  const color=on?(w.colorOn||w.color||'#58a6ff'):(w.colorOff||'#484f58');
  const cacheKey=w.symId+'|'+color;
  ctx.globalAlpha=w.opacity??1;
  if(_svgCache[cacheKey]&&_svgCache[cacheKey].complete){
    ctx.drawImage(_svgCache[cacheKey],w.x,w.y,w.w,w.h);
  }else{
    // Coloriser toutes les lignes du SVG
    let svg=sym.svg.replace(/stroke="(?!none)[^"]*"/g,`stroke="${color}"`);
    const blob=new Blob([svg],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{_svgCache[cacheKey]=img;URL.revokeObjectURL(url);renderAll();};
    img.src=url;
    // Affichage placeholder
    ctx.fillStyle=_bg3();rr(ctx,w.x,w.y,w.w,w.h,5);ctx.fill();
  }
  ctx.globalAlpha=1;
  if(w.label){ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(w.label,w.x+w.w/2,w.y+w.h+2);}
}

// ── Rendu image utilisateur ───────────────────────────────────────────
function rImg(w){
  const img=userImages.find(i=>i.id===w.imageId);
  if(!img){ctx.fillStyle=_bg3();ctx.strokeStyle=_brd();ctx.lineWidth=1;rr(ctx,w.x,w.y,w.w,w.h,6);ctx.fill();ctx.stroke();ctx.fillStyle=_t2();ctx.font='22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🖼',w.x+w.w/2,w.y+w.h/2-6);ctx.font='9px sans-serif';ctx.fillText('Image manquante',w.x+w.w/2,w.y+w.h/2+12);return;}
  ctx.globalAlpha=w.opacity??1;
  if(!_imgCache[w.imageId]){
    const i=new Image();i.onload=()=>{_imgCache[w.imageId]=i;renderAll();};i.src=img.dataUrl;
  }else{
    const i=_imgCache[w.imageId];
    if(w.fit==='stretch'){ctx.drawImage(i,w.x,w.y,w.w,w.h);}
    else{const s=Math.min(w.w/i.naturalWidth,w.h/i.naturalHeight),dw=i.naturalWidth*s,dh=i.naturalHeight*s;ctx.drawImage(i,w.x+(w.w-dw)/2,w.y+(w.h-dh)/2,dw,dh);}
  }
  ctx.globalAlpha=1;
  if(w.label){ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(w.label,w.x+w.w/2,w.y+w.h+2);}
}

// ═══════════════ SYMBOLES ANIMÉS ═══════════════════════════════════════
const ANIM_SYMBOLS={
  boiler:{
    label:'Chaudière granulés',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="14" width="26" height="20" rx="3" fill="none" stroke="#f0883e" stroke-width="1.8"/>
      <ellipse cx="20" cy="14" rx="13" ry="4" fill="none" stroke="#f0883e" stroke-width="1.5"/>
      <path d="M20 28 Q16 23 18 18 Q20 22 22 18 Q24 23 20 28Z" fill="#f85149" opacity="0.8"/>
      <line x1="12" y1="34" x2="12" y2="38" stroke="#f0883e" stroke-width="2"/>
      <line x1="28" y1="34" x2="28" y2="38" stroke="#f0883e" stroke-width="2"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58', dim=Math.min(w,h);
      return`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">
        <defs>
          <radialGradient id="bg_b" cx="50%" cy="60%"><stop offset="0%" stop-color="${on?'#2a1200':'#1a1a1a'}"/><stop offset="100%" stop-color="#0d1117"/></radialGradient>
          <filter id="glow_b"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <!-- Corps chaudière -->
        <rect x="15" y="28" width="70" height="55" rx="6" fill="url(#bg_b)" stroke="${co}" stroke-width="2"/>
        <ellipse cx="50" cy="28" rx="35" ry="10" fill="${on?'#1a0800':'#161b22'}" stroke="${co}" stroke-width="2"/>
        <!-- Conduit vis sans fin -->
        <rect x="20" y="60" width="60" height="14" rx="3" fill="${on?'#150a00':'#111'}" stroke="${co}" stroke-width="1.5"/>
        ${on?`
        <!-- Vis animée -->
        <g style="clip-path:inset(0 0 0 20px)">
          <g style="animation:vis-rotate 0.8s linear infinite;transform-origin:50px 67px;">
            <ellipse cx="50" cy="67" rx="26" ry="5" fill="none" stroke="${co}" stroke-width="1.5" stroke-dasharray="8 4"/>
          </g>
        </g>
        <!-- Granulés qui tombent -->
        <g style="animation:granule-move 0.6s linear infinite;">
          <circle cx="42" cy="45" r="2.5" fill="${co}" opacity="0.9"/>
          <circle cx="50" cy="48" r="2" fill="${co}" opacity="0.7"/>
          <circle cx="58" cy="44" r="2.5" fill="${co}" opacity="0.85"/>
          <circle cx="35" cy="50" r="2" fill="${co}" opacity="0.6"/>
        </g>
        <!-- Flamme principale -->
        <g filter="url(#glow_b)">
          <path style="animation:flame1 0.4s ease-in-out infinite;" d="M50 80 Q42 68 45 55 Q48 64 50 58 Q52 64 55 55 Q58 68 50 80Z" fill="#ff4500" opacity="0.95"/>
          <path style="animation:flame2 0.4s ease-in-out infinite 0.2s;" d="M50 78 Q44 68 47 57 Q50 65 53 57 Q56 68 50 78Z" fill="#ff8c00" opacity="0.8"/>
          <path d="M50 74 Q46 67 48 60 Q50 66 52 60 Q54 67 50 74Z" fill="#ffcc00" opacity="0.7"/>
        </g>
        <!-- Fumée -->
        <circle cx="44" cy="20" r="4" fill="#444" style="animation:smoke 1.2s ease-out infinite;"/>
        <circle cx="50" cy="18" r="5" fill="#333" style="animation:smoke 1.2s ease-out infinite 0.4s;"/>
        <circle cx="56" cy="20" r="4" fill="#444" style="animation:smoke 1.2s ease-out infinite 0.8s;"/>
        `:`
        <!-- État OFF -->
        <text x="50" y="62" text-anchor="middle" font-size="18" fill="#484f58" font-family="sans-serif">■</text>
        `}
        <!-- Pieds -->
        <line x1="28" y1="83" x2="28" y2="92" stroke="${co}" stroke-width="3" stroke-linecap="round"/>
        <line x1="72" y1="83" x2="72" y2="92" stroke="${co}" stroke-width="3" stroke-linecap="round"/>
        <!-- Tuyau entrée eau -->
        <line x1="0" y1="40" x2="15" y2="40" stroke="${co}" stroke-width="2.5"/>
        <!-- Tuyau sortie eau chaude -->
        <line x1="85" y1="40" x2="100" y2="40" stroke="${on?'#f85149':co}" stroke-width="2.5"/>
        <!-- Label état -->
        <text x="50" y="98" text-anchor="middle" font-size="8" fill="${co}" font-family="sans-serif">${on?'EN CHAUFFE':'ARRÊT'}</text>
      </svg>`;
    }
  },

  auger:{
    label:'Vis sans fin',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="16" width="32" height="10" rx="5" fill="none" stroke="#d29922" stroke-width="1.8"/>
      <ellipse cx="20" cy="21" rx="12" ry="4" fill="none" stroke="#d29922" stroke-width="1.2" stroke-dasharray="5 3"/>
      <line x1="4" y1="21" x2="36" y2="21" stroke="#d29922" stroke-width="1" opacity="0.4"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58';
      return`<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">
        <defs><filter id="glow_a"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <!-- Corps tube -->
        <rect x="8" y="18" width="104" height="24" rx="12" fill="${on?'#1a0f00':'#161b22'}" stroke="${co}" stroke-width="2"/>
        <!-- Entrée/sortie -->
        <rect x="0" y="22" width="10" height="16" rx="2" fill="${on?'#1a0f00':'#161b22'}" stroke="${co}" stroke-width="1.5"/>
        <rect x="110" y="22" width="10" height="16" rx="2" fill="${on?'#1a0f00':'#161b22'}" stroke="${co}" stroke-width="1.5"/>
        ${on?`
        <!-- Hélice vis animée -->
        <g filter="url(#glow_a)" style="animation:vis-rotate 0.7s linear infinite;transform-origin:60px 30px;">
          <ellipse cx="60" cy="30" rx="44" ry="9" fill="none" stroke="${co}" stroke-width="2" stroke-dasharray="10 6"/>
        </g>
        <g style="animation:vis-rotate 0.7s linear infinite reverse;transform-origin:60px 30px;">
          <ellipse cx="60" cy="30" rx="36" ry="6" fill="none" stroke="${co}88" stroke-width="1.5" stroke-dasharray="8 5"/>
        </g>
        <!-- Granulés en mouvement -->
        <g style="animation:pipe-flow 0.5s linear infinite;">
          <circle cx="30" cy="30" r="3" fill="${co}" opacity="0.8"/>
          <circle cx="50" cy="30" r="2.5" fill="${co}" opacity="0.7"/>
          <circle cx="70" cy="30" r="3" fill="${co}" opacity="0.8"/>
          <circle cx="90" cy="30" r="2.5" fill="${co}" opacity="0.7"/>
        </g>
        `:`<text x="60" y="34" text-anchor="middle" font-size="10" fill="#484f58" font-family="sans-serif">ARRÊT</text>`}
        <!-- Moteur -->
        <circle cx="60" cy="12" r="8" fill="${on?'#1a0f00':'#161b22'}" stroke="${co}" stroke-width="1.5"/>
        <text x="60" y="16" text-anchor="middle" font-size="8" fill="${co}" font-family="sans-serif">M</text>
        <line x1="60" y1="20" x2="60" y2="18" stroke="${co}" stroke-width="1.5"/>
      </svg>`;
    }
  },

  circulator:{
    label:'Circulateur',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="11" fill="none" stroke="#58a6ff" stroke-width="1.8"/>
      <path d="M15 17 L20 14 L25 17 L25 23 L20 26 L15 23Z" fill="none" stroke="#58a6ff" stroke-width="1.2"/>
      <line x1="4" y1="20" x2="9" y2="20" stroke="#58a6ff" stroke-width="2.5"/>
      <line x1="31" y1="20" x2="36" y2="20" stroke="#58a6ff" stroke-width="2.5"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58';
      return`<svg viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">
        <defs>
          <filter id="glow_c"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <marker id="arr_c" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6Z" fill="${co}"/>
          </marker>
        </defs>
        <!-- Tuyaux -->
        <line x1="0" y1="40" x2="22" y2="40" stroke="${co}" stroke-width="4" stroke-linecap="round"/>
        <line x1="78" y1="40" x2="100" y2="40" stroke="${co}" stroke-width="4" stroke-linecap="round"/>
        ${on?`
        <!-- Flux animé entrée -->
        <line x1="0" y1="40" x2="22" y2="40" stroke="${co}" stroke-width="2" stroke-dasharray="6 4"
              style="stroke-dashoffset:0;animation:pipe-flow 0.5s linear infinite;" opacity="0.6"/>
        <!-- Flux animé sortie -->
        <line x1="78" y1="40" x2="100" y2="40" stroke="${co}" stroke-width="2" stroke-dasharray="6 4"
              style="stroke-dashoffset:0;animation:pipe-flow 0.5s linear infinite;" opacity="0.6"/>
        `:''}
        <!-- Corps pompe -->
        <circle cx="50" cy="40" r="26" fill="${on?'#001a2a':'#161b22'}" stroke="${co}" stroke-width="2.5"/>
        <!-- Volute -->
        <path d="M50 40 Q60 30 68 38 Q72 44 65 52 Q55 58 45 53 Q36 46 40 36 Q44 27 50 30"
              fill="none" stroke="${co}60" stroke-width="1.5"/>
        ${on?`
        <!-- Roue animée -->
        <g filter="url(#glow_c)" style="animation:circ-spin 0.6s linear infinite;transform-origin:50px 40px;">
          <line x1="50" y1="22" x2="50" y2="58" stroke="${co}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="32" y1="40" x2="68" y2="40" stroke="${co}" stroke-width="2.5" stroke-linecap="round"/>
          <line x1="37" y1="27" x2="63" y2="53" stroke="${co}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          <line x1="63" y1="27" x2="37" y2="53" stroke="${co}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
        </g>
        <!-- Centre -->
        <circle cx="50" cy="40" r="5" fill="${co}" filter="url(#glow_c)"/>
        `:`
        <!-- OFF - roue statique -->
        <line x1="50" y1="24" x2="50" y2="56" stroke="#484f58" stroke-width="2" stroke-linecap="round"/>
        <line x1="34" y1="40" x2="66" y2="40" stroke="#484f58" stroke-width="2" stroke-linecap="round"/>
        <circle cx="50" cy="40" r="4" fill="#484f58"/>
        `}
        <!-- Label -->
        <text x="50" y="76" text-anchor="middle" font-size="8" fill="${co}" font-family="sans-serif">${on?'EN MARCHE':'ARRÊT'}</text>
      </svg>`;
    }
  },

  valve3:{
    label:'Vanne 3 voies',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="20" x2="36" y2="20" stroke="#bc8cff" stroke-width="2.5"/>
      <line x1="20" y1="20" x2="20" y2="36" stroke="#bc8cff" stroke-width="2.5"/>
      <circle cx="20" cy="20" r="9" fill="none" stroke="#bc8cff" stroke-width="1.8"/>
      <line x1="20" y1="13" x2="20" y2="27" stroke="#bc8cff" stroke-width="2" transform="rotate(-30,20,20)"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58';
      const ang=on?-30:90; // position du volet
      return`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">
        <defs><filter id="glow_v"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <!-- Tuyaux -->
        <line x1="0" y1="50" x2="32" y2="50" stroke="${co}" stroke-width="5" stroke-linecap="round"/>
        <line x1="68" y1="50" x2="100" y2="50" stroke="${co}" stroke-width="5" stroke-linecap="round"/>
        <line x1="50" y1="68" x2="50" y2="100" stroke="${on?co:'#333'}" stroke-width="5" stroke-linecap="round"/>
        ${on?`
        <!-- Flux animés -->
        <line x1="0" y1="50" x2="32" y2="50" stroke="${co}" stroke-width="2.5" stroke-dasharray="7 5"
              style="animation:pipe-flow 0.6s linear infinite;" opacity="0.7"/>
        <line x1="50" y1="68" x2="50" y2="100" stroke="${co}" stroke-width="2.5" stroke-dasharray="7 5"
              style="animation:flow-dash 0.6s linear infinite;" opacity="0.7"/>
        `:''}
        <!-- Corps vanne -->
        <circle cx="50" cy="50" r="20" fill="${on?'#140a1e':'#161b22'}" stroke="${co}" stroke-width="2.5"/>
        <!-- Actionneur -->
        <rect x="44" y="16" width="12" height="20" rx="3" fill="${on?'#1e0f2e':'#1c2128'}" stroke="${co}" stroke-width="1.5"/>
        <line x1="50" y1="16" x2="50" y2="30" stroke="${co}" stroke-width="2"/>
        <!-- Volet animé -->
        <g style="transform-origin:50px 50px;animation:${on?'valve3-open':'valve3-close'} 1.2s ease-in-out infinite;" filter="url(#glow_v)">
          <line x1="50" y1="34" x2="50" y2="66" stroke="${co}" stroke-width="4" stroke-linecap="round"/>
          <ellipse cx="50" cy="50" rx="2" ry="14" fill="${co}" opacity="0.4"/>
        </g>
        <!-- Centre -->
        <circle cx="50" cy="50" r="4" fill="${co}"/>
        <!-- Labels voies -->
        <text x="16" y="46" text-anchor="middle" font-size="7" fill="${co}aa" font-family="sans-serif">A</text>
        <text x="84" y="46" text-anchor="middle" font-size="7" fill="${co}aa" font-family="sans-serif">B</text>
        <text x="54" y="88" text-anchor="left" font-size="7" fill="${on?co:'#333'}" font-family="sans-serif">AB</text>
        <!-- État -->
        <text x="50" y="98" text-anchor="middle" font-size="7" fill="${co}" font-family="sans-serif">${on?'OUVERT':'FERMÉ'}</text>
      </svg>`;
    }
  },

  pump_anim:{
    label:'Pompe centrifuge',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="12" fill="none" stroke="#3fb950" stroke-width="1.8"/>
      <path d="M16 22 Q19 16 22 16 Q27 16 28 20" fill="none" stroke="#3fb950" stroke-width="1.5"/>
      <line x1="4" y1="22" x2="10" y2="22" stroke="#3fb950" stroke-width="2.5"/>
      <line x1="22" y1="10" x2="22" y2="4" stroke="#3fb950" stroke-width="2.5"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58';
      return`<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">
        <defs><filter id="glow_p"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <!-- Tuyau aspiration -->
        <line x1="0" y1="55" x2="28" y2="55" stroke="${co}" stroke-width="5" stroke-linecap="round"/>
        <!-- Tuyau refoulement -->
        <line x1="55" y1="0" x2="55" y2="28" stroke="${co}" stroke-width="5" stroke-linecap="round"/>
        ${on?`
        <line x1="0" y1="55" x2="28" y2="55" stroke="${co}" stroke-width="2.5" stroke-dasharray="6 4" style="animation:pipe-flow 0.4s linear infinite;" opacity="0.7"/>
        <line x1="55" y1="0" x2="55" y2="28" stroke="${co}" stroke-width="2.5" stroke-dasharray="6 4" style="animation:flow-dash 0.4s linear infinite;" opacity="0.7"/>
        `:''}
        <!-- Corps pompe -->
        <circle cx="55" cy="55" r="32" fill="${on?'#001a00':'#161b22'}" stroke="${co}" stroke-width="2.5"/>
        <!-- Volute spirale -->
        <path d="M55 55 Q72 42 76 55 Q78 68 65 76 Q50 82 40 72 Q30 60 38 47 Q46 36 55 38" fill="none" stroke="${co}50" stroke-width="1.5"/>
        ${on?`
        <!-- Roue tournante -->
        <g filter="url(#glow_p)" style="animation:circ-spin 0.5s linear infinite;transform-origin:55px 55px;">
          <line x1="55" y1="33" x2="55" y2="77" stroke="${co}" stroke-width="3" stroke-linecap="round"/>
          <line x1="33" y1="55" x2="77" y2="55" stroke="${co}" stroke-width="3" stroke-linecap="round"/>
          <line x1="40" y1="40" x2="70" y2="70" stroke="${co}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          <line x1="70" y1="40" x2="40" y2="70" stroke="${co}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>
          <!-- Aubes -->
          <path d="M55 37 Q62 43 60 55" fill="none" stroke="${co}" stroke-width="2"/>
          <path d="M73 55 Q67 62 55 60" fill="none" stroke="${co}" stroke-width="2"/>
          <path d="M55 73 Q48 67 50 55" fill="none" stroke="${co}" stroke-width="2"/>
          <path d="M37 55 Q43 48 55 50" fill="none" stroke="${co}" stroke-width="2"/>
        </g>
        <circle cx="55" cy="55" r="6" fill="${co}" filter="url(#glow_p)"/>
        `:`
        <line x1="55" y1="35" x2="55" y2="75" stroke="#484f58" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="35" y1="55" x2="75" y2="55" stroke="#484f58" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="55" cy="55" r="5" fill="#484f58"/>
        `}
        <text x="55" y="96" text-anchor="middle" font-size="8" fill="${co}" font-family="sans-serif">${on?'EN MARCHE':'ARRÊT'}</text>
      </svg>`;
    }
  },

  pipe_flow:{
    label:'Flux tuyau',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="15" width="32" height="10" rx="5" fill="none" stroke="#00d4ff" stroke-width="1.8"/>
      <path d="M10 20 L18 16 L26 20 L34 16" fill="none" stroke="#00d4ff" stroke-width="1.5" stroke-dasharray="4 2"/>
    </svg>`,
    render(on,c,w,h){
      const co=on?c:'#484f58';
      return`<svg viewBox="0 0 140 50" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(h*0.55)}">
        <defs>
          <linearGradient id="pipe_grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${co}40"/>
            <stop offset="40%" stop-color="${co}"/>
            <stop offset="100%" stop-color="${co}40"/>
          </linearGradient>
          <filter id="glow_pf"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <!-- Corps tuyau -->
        <rect x="4" y="12" width="132" height="26" rx="13" fill="${on?'#001520':'#161b22'}" stroke="${co}" stroke-width="2"/>
        <!-- Reflet haut -->
        <rect x="12" y="14" width="116" height="5" rx="2" fill="${co}20"/>
        ${on?`
        <!-- Liquide animé -->
        <rect x="5" y="13" width="130" height="24" rx="12" fill="${co}15"/>
        <!-- Bulles/flux -->
        <g filter="url(#glow_pf)" style="animation:pipe-flow 0.5s linear infinite;">
          <circle cx="20" cy="25" r="4" fill="${co}" opacity="0.9"/>
          <circle cx="45" cy="25" r="3" fill="${co}" opacity="0.7"/>
          <circle cx="70" cy="25" r="4" fill="${co}" opacity="0.9"/>
          <circle cx="95" cy="25" r="3" fill="${co}" opacity="0.7"/>
          <circle cx="120" cy="25" r="4" fill="${co}" opacity="0.9"/>
        </g>
        <!-- Flèches direction -->
        <g style="animation:pipe-flow 0.5s linear infinite 0.25s;" opacity="0.5">
          <path d="M30 22 L38 25 L30 28" fill="none" stroke="${co}" stroke-width="1.5"/>
          <path d="M60 22 L68 25 L60 28" fill="none" stroke="${co}" stroke-width="1.5"/>
          <path d="M90 22 L98 25 L90 28" fill="none" stroke="${co}" stroke-width="1.5"/>
        </g>
        `:`
        <text x="70" y="29" text-anchor="middle" font-size="10" fill="#484f58" font-family="sans-serif">— ARRÊT —</text>
        `}
        <!-- Raccords -->
        <rect x="0" y="18" width="7" height="14" rx="2" fill="${on?'#001520':'#161b22'}" stroke="${co}" stroke-width="1.5"/>
        <rect x="133" y="18" width="7" height="14" rx="2" fill="${on?'#001520':'#161b22'}" stroke="${co}" stroke-width="1.5"/>
      </svg>`;
    }
  },

  // ── ÉLECTRICITÉ ────────────────────────────────────────────────────────
  motor:{
    label:'Moteur électrique',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="#58a6ff" stroke-width="2"/><text x="20" y="24" text-anchor="middle" font-size="12" font-weight="bold" fill="#58a6ff">M</text></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,r=Math.min(w,h)*0.38;
      const t=Date.now()/300;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'22':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      if(on){
        // Flèches de rotation animées
        const a1=t%(Math.PI*2), a2=a1+Math.PI*2/3, a3=a2+Math.PI*2/3;
        for(const a of [a1,a2,a3]){
          const x1=cx+r*0.55*Math.cos(a),y1=cy+r*0.55*Math.sin(a);
          const x2=cx+r*0.75*Math.cos(a+0.5),y2=cy+r*0.75*Math.sin(a+0.5);
          s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
        }
      }
      s+=`<text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="${r*0.7}" font-weight="bold" fill="${on?c:'#484f58'}">M</text>`;
      s+=`</svg>`;return s;}
  },
  contactor_anim:{
    label:'Contacteur/Relais',
    preview:`<svg viewBox="0 0 40 40"><rect x="8" y="8" width="24" height="24" rx="3" fill="none" stroke="#3fb950" stroke-width="2"/><line x1="20" y1="12" x2="20" y2="28" stroke="#3fb950" stroke-width="3"/><circle cx="20" cy="20" r="4" fill="#3fb950"/></svg>`,
    render(on,c,w,h){
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const bx=w*0.15,by=h*0.12,bw=w*0.7,bh=h*0.76;
      s+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="4" fill="${on?c+'22':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Contact mobile
      const cy2=on?h*0.42:h*0.52;
      s+=`<line x1="${w*0.28}" y1="${cy2}" x2="${w*0.72}" y2="${cy2}" stroke="${on?c:'#484f58'}" stroke-width="3" stroke-linecap="round"/>`;
      // Contacts fixes
      s+=`<line x1="${w*0.3}" y1="${h*0.25}" x2="${w*0.3}" y2="${h*0.38}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.7}" y1="${h*0.25}" x2="${w*0.7}" y2="${h*0.38}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.3}" y1="${h*0.62}" x2="${w*0.3}" y2="${h*0.75}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.7}" y1="${h*0.62}" x2="${w*0.7}" y2="${h*0.75}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      // Bobine
      s+=`<circle cx="${w*0.5}" cy="${h*0.82}" r="${w*0.1}" fill="none" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on) s+=`<circle cx="${w*0.5}" cy="${h*0.82}" r="${w*0.06}" fill="${c}"/>`;
      s+=`</svg>`;return s;}
  },
  disjoncteur:{
    label:'Disjoncteur',
    preview:`<svg viewBox="0 0 40 40"><rect x="12" y="4" width="16" height="32" rx="3" fill="none" stroke="#f85149" stroke-width="2"/><rect x="16" y="14" width="8" height="8" rx="1" fill="#f85149"/></svg>`,
    render(on,c,w,h){
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const bx=w*0.28,bw=w*0.44;
      s+=`<rect x="${bx}" y="${h*0.05}" width="${bw}" height="${h*0.9}" rx="4" fill="${on?'#0d1f0d':'#1f0d0d'}" stroke="${on?c:'#f85149'}" stroke-width="1.5"/>`;
      // Levier
      const ly=on?h*0.28:h*0.52;
      s+=`<rect x="${bx+bw*0.2}" y="${ly}" width="${bw*0.6}" height="${h*0.2}" rx="3" fill="${on?c:'#f85149'}"/>`;
      // Ligne entrée/sortie
      s+=`<line x1="${w*0.5}" y1="0" x2="${w*0.5}" y2="${h*0.05}" stroke="${on?c:'#f85149'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.5}" y1="${h*0.95}" x2="${w*0.5}" y2="${h}" stroke="${on?c:'#f85149'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  voyant_led:{
    label:'Voyant LED',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="none" stroke="#3fb950" stroke-width="2"/><circle cx="20" cy="20" r="7" fill="#3fb950" opacity="0.8"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,r=Math.min(w,h)*0.38;
      const t=Date.now()/500;
      const glow=on?(0.6+0.4*Math.sin(t)):0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      if(on){
        s+=`<circle cx="${cx}" cy="${cy}" r="${r*1.4}" fill="${c}" opacity="${(glow*0.15).toFixed(2)}"/>`;
        s+=`<circle cx="${cx}" cy="${cy}" r="${r*1.15}" fill="${c}" opacity="${(glow*0.25).toFixed(2)}"/>`;
      }
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'33':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r*0.6}" fill="${on?c:'#333'}" opacity="${on?'0.9':'1'}"/>`;
      if(on) s+=`<circle cx="${(cx-r*0.2).toFixed(1)}" cy="${(cy-r*0.2).toFixed(1)}" r="${r*0.15}" fill="white" opacity="0.4"/>`;
      s+=`</svg>`;return s;}
  },
  // ── PLOMBERIE / HYDRAULIQUE ─────────────────────────────────────────────
  pump_centrifuge:{
    label:'Pompe centrifuge',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13" fill="none" stroke="#58a6ff" stroke-width="2"/><path d="M20 10 L26 20 L20 20 Z" fill="#58a6ff"/><line x1="7" y1="20" x2="14" y2="20" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,r=Math.min(w,h)*0.38;
      const t=Date.now()/200;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'15':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      if(on){
        // Pale tournante
        for(let i=0;i<3;i++){
          const a=t+i*Math.PI*2/3;
          const x1=cx+r*0.15*Math.cos(a),y1=cy+r*0.15*Math.sin(a);
          const x2=cx+r*0.65*Math.cos(a+0.8),y2=cy+r*0.65*Math.sin(a+0.8);
          s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`;
        }
      }
      // Orifices
      s+=`<line x1="0" y1="${cy}" x2="${cx-r}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="3"/>`;
      s+=`<line x1="${cx}" y1="0" x2="${cx}" y2="${cy-r}" stroke="${on?c:'#484f58'}" stroke-width="3"/>`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r*0.12}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  vanne_papillon:{
    label:'Vanne papillon',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="3"/><ellipse cx="20" cy="20" rx="10" ry="5" fill="none" stroke="#58a6ff" stroke-width="2" transform="rotate(30 20 20)"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Corps
      s+=`<line x1="0" y1="${cy}" x2="${cx-h*0.3}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.12}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+h*0.3}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.12}" stroke-linecap="round"/>`;
      // Disque vanne
      const ang=on?0.1:Math.PI/2*0.85;
      const ry=Math.abs(Math.cos(ang))*h*0.28+1;
      s+=`<ellipse cx="${cx}" cy="${cy}" rx="${h*0.28}" ry="${ry}" fill="${on?c+'33':'#333'}" stroke="${on?c:'#888'}" stroke-width="1.5"/>`;
      // Tige
      s+=`<line x1="${cx}" y1="${cy-h*0.28}" x2="${cx}" y2="${cy-h*0.48}" stroke="${on?c:'#888'}" stroke-width="2"/>`;
      s+=`<circle cx="${cx}" cy="${cy-h*0.5}" r="${h*0.07}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  robinet_boisseau:{
    label:'Robinet à boisseau',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="3"/><rect x="14" y="14" width="12" height="12" rx="2" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="20" y1="8" x2="20" y2="14" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,sz=Math.min(w,h)*0.3;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${cx-sz}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+sz}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<rect x="${cx-sz}" y="${cy-sz}" width="${sz*2}" height="${sz*2}" rx="3" fill="${on?c+'22':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Boisseau
      const bAngle=on?0:Math.PI/2;
      const bx1=cx+sz*0.5*Math.cos(bAngle),by1=cy+sz*0.5*Math.sin(bAngle);
      const bx2=cx-sz*0.5*Math.cos(bAngle),by2=cy-sz*0.5*Math.sin(bAngle);
      s+=`<line x1="${bx1.toFixed(1)}" y1="${by1.toFixed(1)}" x2="${bx2.toFixed(1)}" y2="${by2.toFixed(1)}" stroke="${on?c:'#888'}" stroke-width="3" stroke-linecap="round"/>`;
      // Poignée
      const hx=cx+sz*0.85*Math.cos(bAngle-Math.PI/2);
      const hy=cy+sz*0.85*Math.sin(bAngle-Math.PI/2);
      s+=`<line x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<circle cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="${sz*0.15}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  clapet_anti_retour:{
    label:'Clapet anti-retour',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="3"/><polygon points="15,12 25,20 15,28" fill="#58a6ff" opacity="0.7"/><line x1="25" y1="12" x2="25" y2="28" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cy=h/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      const mx=w*0.35,rh=h*0.35;
      s+=`<polygon points="${mx},${cy-rh} ${mx+w*0.25},${cy} ${mx},${cy+rh}" fill="${on?c+'55':'#333'}" stroke="${on?c:'#888'}" stroke-width="1.5"/>`;
      s+=`<line x1="${mx+w*0.25}" y1="${cy-rh}" x2="${mx+w*0.25}" y2="${cy+rh}" stroke="${on?c:'#888'}" stroke-width="2"/>`;
      if(on){
        // Flèche débit
        const t=Date.now()/600;
        const ax=(w*0.65+w*0.25*((t%1)));
        s+=`<polygon points="${ax},${cy-5} ${ax+8},${cy} ${ax},${cy+5}" fill="${c}" opacity="0.7"/>`;
      }
      s+=`</svg>`;return s;}
  },
  filtre:{
    label:'Filtre',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="3"/><polygon points="12,10 28,10 24,22 28,30 12,30 16,22" fill="none" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cy=h/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${w*0.25}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${w*0.75}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      const fx=w*0.25,fw=w*0.5,fh=h*0.7,fy=h*0.15;
      s+=`<polygon points="${fx},${fy} ${fx+fw},${fy} ${fx+fw*0.75},${fy+fh*0.55} ${fx+fw*0.85},${fy+fh} ${fx+fw*0.15},${fy+fh} ${fx+fw*0.25},${fy+fh*0.55}" fill="${on?c+'15':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Traits filtre
      for(let i=1;i<4;i++){
        const lx=fx+fw*0.2+i*fw*0.15,ly1=fy+fh*0.5,ly2=fy+fh*0.75;
        s+=`<line x1="${lx}" y1="${ly1}" x2="${lx}" y2="${ly2}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      }
      s+=`</svg>`;return s;}
  },
  // ── CHAUFFAGE / CLIMATISATION ─────────────────────────────────────────
  radiateur:{
    label:'Radiateur',
    preview:`<svg viewBox="0 0 40 40"><rect x="4" y="10" width="32" height="20" rx="2" fill="none" stroke="#f0883e" stroke-width="2"/><line x1="13" y1="10" x2="13" y2="30" stroke="#f0883e" stroke-width="2"/><line x1="20" y1="10" x2="20" y2="30" stroke="#f0883e" stroke-width="2"/><line x1="27" y1="10" x2="27" y2="30" stroke="#f0883e" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const t=Date.now()/800;
      // Corps
      s+=`<rect x="${w*0.05}" y="${h*0.2}" width="${w*0.9}" height="${h*0.6}" rx="3" fill="${on?c+'18':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Éléments
      for(let i=0;i<4;i++){
        const ex=w*(0.18+i*0.22);
        s+=`<line x1="${ex}" y1="${h*0.2}" x2="${ex}" y2="${h*0.8}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      }
      if(on){
        // Ondes de chaleur
        for(let i=0;i<3;i++){
          const waveX=w*(0.25+i*0.25);
          const phase=t+i;
          const wy=h*0.05+Math.sin(phase)*h*0.04;
          s+=`<path d="M${waveX-4},${wy+h*0.08} Q${waveX},${wy} ${waveX+4},${wy+h*0.08}" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.7"/>`;
          s+=`<path d="M${waveX-4},${wy} Q${waveX},${wy-h*0.08} ${waveX+4},${wy}" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.4"/>`;
        }
      }
      s+=`</svg>`;return s;}
  },
  ventilateur:{
    label:'Ventilateur CTA',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="#58a6ff" stroke-width="2"/><path d="M20 6 Q26 13 20 20 Q14 13 20 6Z" fill="#58a6ff" opacity="0.7"/><path d="M34 20 Q27 26 20 20 Q27 14 34 20Z" fill="#58a6ff" opacity="0.7"/><path d="M6 20 Q13 14 20 20 Q13 26 6 20Z" fill="#58a6ff" opacity="0.7"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,r=Math.min(w,h)*0.42;
      const t=on?Date.now()/150:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'10':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // 3 pales
      for(let i=0;i<3;i++){
        const a=t+i*Math.PI*2/3;
        const x1=cx+r*0.15*Math.cos(a),y1=cy+r*0.15*Math.sin(a);
        const cx2=cx+r*0.65*Math.cos(a+0.6),cy2=cy+r*0.65*Math.sin(a+0.6);
        const x2=cx+r*0.72*Math.cos(a),y2=cy+r*0.72*Math.sin(a);
        s+=`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx2.toFixed(1)},${cy2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="${on?c+'66':'#333'}" stroke="${on?c:'#484f58'}" stroke-width="1"/>`;
      }
      s+=`<circle cx="${cx}" cy="${cy}" r="${r*0.15}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  echangeur:{
    label:'Échangeur thermique',
    preview:`<svg viewBox="0 0 40 40"><rect x="8" y="8" width="24" height="24" rx="4" fill="none" stroke="#d29922" stroke-width="2"/><path d="M8 16 Q20 12 32 16" fill="none" stroke="#f0883e" stroke-width="1.5"/><path d="M8 20 Q20 24 32 20" fill="none" stroke="#58a6ff" stroke-width="1.5"/><path d="M8 24 Q20 20 32 24" fill="none" stroke="#f0883e" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const t=Date.now()/600;
      s+=`<rect x="${w*0.1}" y="${h*0.1}" width="${w*0.8}" height="${h*0.8}" rx="5" fill="${on?c+'10':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Tuyaux internes sinusoïdaux
      for(let i=0;i<4;i++){
        const py=h*(0.22+i*0.17);
        const phase=(i%2===0?t:-t);
        const hot=i%2===0;
        const cc=hot?'#f0883e':'#58a6ff';
        let d=`M${w*0.1},${py}`;
        for(let x=0;x<=1;x+=0.05){
          const px=w*(0.1+x*0.8);
          const py2=py+Math.sin(x*Math.PI*3+phase)*h*0.04;
          d+=` L${px.toFixed(1)},${py2.toFixed(1)}`;
        }
        s+=`<path d="${d}" fill="none" stroke="${on?cc:'#484f58'}" stroke-width="1.5"/>`;
      }
      s+=`</svg>`;return s;}
  },
  // ── CAPTEURS / INSTRUMENTATION ─────────────────────────────────────────
  capteur_temperature:{
    label:'Sonde température',
    preview:`<svg viewBox="0 0 40 40"><rect x="17" y="4" width="6" height="22" rx="3" fill="none" stroke="#d29922" stroke-width="2"/><circle cx="20" cy="30" r="6" fill="none" stroke="#d29922" stroke-width="2"/><circle cx="20" cy="30" r="3" fill="#d29922"/></svg>`,
    render(on,c,w,h){
      const cx=w/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const bulbY=h*0.75,bulbR=h*0.12,tubeTop=h*0.08;
      // Tube
      s+=`<rect x="${cx-w*0.08}" y="${tubeTop}" width="${w*0.16}" height="${bulbY-tubeTop}" rx="${w*0.08}" fill="${on?c+'22':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Niveau (simulé)
      const lvl=on?0.6:0.2;
      s+=`<rect x="${cx-w*0.045}" y="${tubeTop+(bulbY-tubeTop)*(1-lvl)}" width="${w*0.09}" height="${(bulbY-tubeTop)*lvl}" rx="${w*0.045}" fill="${on?c:'#484f58'}"/>`;
      // Bulbe
      s+=`<circle cx="${cx}" cy="${bulbY}" r="${bulbR*1.3}" fill="${on?c+'33':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<circle cx="${cx}" cy="${bulbY}" r="${bulbR*0.75}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  capteur_pression:{
    label:'Manomètre',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="#bc8cff" stroke-width="2"/><path d="M9 28 A14 14 0 0 1 31 28" fill="none" stroke="#bc8cff" stroke-width="1.5"/><line x1="20" y1="20" x2="28" y2="14" stroke="#bc8cff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.5,r=Math.min(w,h)*0.4;
      const t=on?(Math.sin(Date.now()/2000)*0.3+0.6):0.1;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'10':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Arc graduation
      const a0=Math.PI*0.75,a1=Math.PI*2.25;
      const sx=cx+r*0.85*Math.cos(a0),sy=cy+r*0.85*Math.sin(a0);
      const ex=cx+r*0.85*Math.cos(a1),ey=cy+r*0.85*Math.sin(a1);
      s+=`<path d="M${sx.toFixed(1)},${sy.toFixed(1)} A${(r*0.85).toFixed(1)},${(r*0.85).toFixed(1)} 0 1 1 ${ex.toFixed(1)},${ey.toFixed(1)}" fill="none" stroke="${on?c+'44':'#333'}" stroke-width="2"/>`;
      // Aiguille
      const na=a0+(a1-a0)*t;
      const nx=cx+r*0.65*Math.cos(na),ny=cy+r*0.65*Math.sin(na);
      s+=`<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r*0.08}" fill="${on?c:'#484f58'}"/>`;
      // Raccord bas
      s+=`<line x1="${cx}" y1="${cy+r}" x2="${cx}" y2="${h}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  niveau_reservoir:{
    label:'Réservoir niveau',
    preview:`<svg viewBox="0 0 40 40"><rect x="8" y="6" width="24" height="28" rx="3" fill="none" stroke="#58a6ff" stroke-width="2"/><rect x="8" y="22" width="24" height="12" rx="0" fill="#58a6ff" opacity="0.4"/></svg>`,
    render(on,c,w,h){
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const t=Date.now()/1000;
      const lvl=on?(0.5+0.1*Math.sin(t)):0.15;
      const bx=w*0.12,bw=w*0.76,bh=h*0.82,by=h*0.05;
      // Cuve
      s+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#0d1117" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Liquide
      const ly=by+bh*(1-lvl);
      s+=`<rect x="${bx+1}" y="${ly}" width="${bw-2}" height="${bh-(ly-by)}" fill="${on?c+'33':'#1a2030'}"/>`;
      // Vague
      if(on){
        const wave=Math.sin(t*2)*3;
        s+=`<path d="M${bx+1},${ly+wave} Q${bx+bw/4},${ly-wave} ${bx+bw/2},${ly+wave} Q${bx+bw*3/4},${ly-wave+4} ${bx+bw-1},${ly+wave}" fill="none" stroke="${c}" stroke-width="1" opacity="0.6"/>`;
      }
      // Indicateur niveau (barre droite)
      s+=`<line x1="${bx+bw+3}" y1="${by}" x2="${bx+bw+3}" y2="${by+bh}" stroke="${on?c+'44':'#333'}" stroke-width="2"/>`;
      s+=`<line x1="${bx+bw+1}" y1="${ly}" x2="${bx+bw+5}" y2="${ly}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  // ── ÉNERGIE / PRODUCTION ──────────────────────────────────────────────
  panneau_solaire:{
    label:'Panneau solaire',
    preview:`<svg viewBox="0 0 40 40"><rect x="4" y="12" width="32" height="18" rx="2" fill="#1a2a4a" stroke="#58a6ff" stroke-width="2"/><line x1="17" y1="12" x2="17" y2="30" stroke="#58a6ff" stroke-width="1"/><line x1="23" y1="12" x2="23" y2="30" stroke="#58a6ff" stroke-width="1"/><line x1="4" y1="20" x2="36" y2="20" stroke="#58a6ff" stroke-width="1"/></svg>`,
    render(on,c,w,h){
      const t=Date.now()/1000;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<rect x="${w*0.04}" y="${h*0.2}" width="${w*0.92}" height="${h*0.55}" rx="3" fill="${on?'#0d1f3a':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Grille cellules
      for(let i=1;i<3;i++){
        const lx=w*(0.04+i*0.92/3);
        s+=`<line x1="${lx}" y1="${h*0.2}" x2="${lx}" y2="${h*0.75}" stroke="${on?c+'44':'#333'}" stroke-width="1"/>`;
      }
      s+=`<line x1="${w*0.04}" y1="${h*0.475}" x2="${w*0.96}" y2="${h*0.475}" stroke="${on?c+'44':'#333'}" stroke-width="1"/>`;
      if(on){
        // Reflet lumineux
        const shine=(0.3+0.2*Math.sin(t));
        s+=`<rect x="${w*0.06}" y="${h*0.22}" width="${w*0.35}" height="${h*0.12}" rx="2" fill="white" opacity="${shine.toFixed(2)}"/>`;
        // Éclair production
        s+=`<text x="${w*0.5}" y="${h*0.58}" text-anchor="middle" font-size="${h*0.18}" fill="${c}" opacity="0.9">⚡</text>`;
      }
      // Pied
      s+=`<line x1="${w*0.3}" y1="${h*0.75}" x2="${w*0.5}" y2="${h*0.92}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.7}" y1="${h*0.75}" x2="${w*0.5}" y2="${h*0.92}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  compteur_energie:{
    label:'Compteur énergie',
    preview:`<svg viewBox="0 0 40 40"><rect x="6" y="6" width="28" height="28" rx="4" fill="none" stroke="#d29922" stroke-width="2"/><text x="20" y="24" text-anchor="middle" font-size="9" fill="#d29922">kWh</text></svg>`,
    render(on,c,w,h){
      const t=Date.now()/50;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<rect x="${w*0.08}" y="${h*0.08}" width="${w*0.84}" height="${h*0.84}" rx="4" fill="${on?c+'10':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Affichage compteur
      const val=on?Math.floor(t%10000).toString().padStart(4,'0'):'0000';
      s+=`<rect x="${w*0.14}" y="${h*0.22}" width="${w*0.72}" height="${h*0.35}" rx="2" fill="#000"/>`;
      s+=`<text x="${w*0.5}" y="${h*0.47}" text-anchor="middle" font-family="monospace" font-size="${h*0.22}" fill="${on?c:'#484f58'}">${val}</text>`;
      s+=`<text x="${w*0.5}" y="${h*0.75}" text-anchor="middle" font-size="${h*0.14}" fill="${on?c+'aa':'#484f58'}">kWh</text>`;
      s+=`</svg>`;return s;}
  },
  batterie_niveau:{
    label:'Batterie (niveau)',
    preview:`<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="10" width="26" height="20" rx="3" fill="none" stroke="#3fb950" stroke-width="1.8"/>
      <rect x="32" y="16" width="3" height="8" rx="1" fill="#3fb950"/>
      <rect x="9" y="14" width="14" height="12" fill="#3fb95055"/>
    </svg>`,
    render(on,c,w,h,wObj){
      // Lecture directe du registre lié (0-100%), indépendamment du booléen 'on'
      const niveau=(wObj&&wObj.varRef!=null)?getV(wObj.varRef):null;
      const known=niveau!=null&&!isNaN(niveau);
      const pct=known?Math.max(0,Math.min(100,niveau)):0;
      // Détection "en charge" par dérivée temporelle (pas besoin d'un 2e registre)
      const now=Date.now();
      if(wObj){
        if(wObj._battPrevT==null){wObj._battPrev=pct;wObj._battPrevT=now;wObj._battCharging=false;}
        else if(now-wObj._battPrevT>1500){
          const delta=pct-wObj._battPrev;
          if(delta>0.3) wObj._battCharging=true;
          else if(delta<-0.05) wObj._battCharging=false;
          wObj._battPrev=pct;wObj._battPrevT=now;
        }
      }
      const charging=wObj?!!wObj._battCharging:false;
      const co=!known?'#484f58':pct<15?'#f85149':pct<40?'#d29922':'#3fb950';
      const t=now/1000;
      let s=`<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" style="display:block;">`;
      s+=`<defs><filter id="glow_batt"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
      s+=`<rect x="4" y="8" width="82" height="44" rx="5" fill="#0d1117" stroke="${co}" stroke-width="2.5"/>`;
      s+=`<rect x="86" y="20" width="8" height="20" rx="2" fill="${co}"/>`;
      const innerX=8,innerY=12,innerW=74,innerH=36,fillW=innerW*(pct/100);
      s+=`<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="#161b22"/>`;
      if(known){
        s+=`<rect x="${innerX}" y="${innerY}" width="${fillW.toFixed(1)}" height="${innerH}" fill="${co}" opacity="0.85"/>`;
        if(charging){
          const shimmer=(Math.sin(t*4)*0.25+0.55);
          s+=`<rect x="${innerX}" y="${innerY}" width="${fillW.toFixed(1)}" height="${innerH}" fill="white" opacity="${(shimmer*0.18).toFixed(2)}"/>`;
        }
      }
      for(let i=1;i<4;i++){
        const lx=innerX+innerW*i/4;
        s+=`<line x1="${lx}" y1="${innerY}" x2="${lx}" y2="${innerY+innerH}" stroke="#0d1117" stroke-width="1.5" opacity="0.6"/>`;
      }
      if(charging){
        const blink=(Math.sin(t*3)+1)/2;
        s+=`<g filter="url(#glow_batt)" opacity="${(0.55+0.45*blink).toFixed(2)}"><path d="M48 14 L36 34 L46 34 L42 50 L58 28 L48 28Z" fill="#ffd740"/></g>`;
      }
      if(known&&pct<15&&!charging){
        const blink=(Math.sin(t*5)+1)/2;
        s+=`<rect x="4" y="8" width="82" height="44" rx="5" fill="none" stroke="#f85149" stroke-width="${(2+2*blink).toFixed(1)}" opacity="${(0.4+0.5*blink).toFixed(2)}"/>`;
      }
      s+=`<text x="45" y="33" text-anchor="middle" font-size="15" font-weight="bold" font-family="monospace" fill="${known?'#fff':'#484f58'}" opacity="0.92">${known?Math.round(pct)+'%':'—'}</text>`;
      s+=`</svg>`;
      return s;
    }
  },


  // ── NOUVEAUX SYMBOLES ──────────────────────────────────────────────────
  vis_sans_fin2:{
    label:'Vis sans fin',
    preview:`<svg viewBox="0 0 40 40"><rect x="4" y="14" width="32" height="12" rx="6" fill="none" stroke="#50ff50" stroke-width="2"/><path d="M10 14 Q13 20 10 26 M16 14 Q19 20 16 26 M22 14 Q25 20 22 26 M28 14 Q31 20 28 26" fill="none" stroke="#50ff50" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/120:0;
      const cy=h/2, r=h*0.32, len=w*0.88, x0=w*0.06;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Corps tube
      s+=`<rect x="${x0}" y="${cy-r}" width="${len}" height="${r*2}" rx="${r}" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Hélice animée - segments de spirale
      const pitch=h*0.55, nturns=Math.floor(len/pitch)+2;
      for(let i=-1;i<nturns;i++){
        const phase=((t*0.01+i)%1+1)%1;
        const sx=x0+i*pitch+phase*pitch;
        if(sx<x0-pitch||sx>x0+len+pitch)continue;
        // Demi-hélice avant
        const pts=[];
        for(let j=0;j<=12;j++){
          const a=j/12*Math.PI;
          const px=sx+j/12*pitch*0.92;
          const py=cy+r*0.72*Math.sin(a+Math.PI);
          pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        }
        const x1=parseFloat(pts[0]), x2=parseFloat(pts[pts.length-1].split(',')[0]);
        if(x1>x0+len||x2<x0)continue;
        s+=`<polyline points="${pts.join(' ')}" fill="none" stroke="${on?c:'#484f58'}" stroke-width="2.5" stroke-linecap="round"/>`;
        // Demi-hélice arrière (atténuée)
        const pts2=[];
        for(let j=0;j<=12;j++){
          const a=j/12*Math.PI;
          const px=sx+j/12*pitch*0.92;
          const py=cy+r*0.72*Math.sin(a);
          pts2.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        }
        s+=`<polyline points="${pts2.join(' ')}" fill="none" stroke="${on?c+'55':'#333'}" stroke-width="1.5" stroke-linecap="round"/>`;
      }
      // Caps
      s+=`<circle cx="${x0}" cy="${cy}" r="${r*0.85}" fill="${on?c+'18':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<circle cx="${x0+len}" cy="${cy}" r="${r*0.85}" fill="${on?c+'18':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`</svg>`;return s;}
  },
  flamme:{
    label:'Brûleur / Flamme',
    preview:`<svg viewBox="0 0 40 40"><path d="M20 36 C8 36 6 24 12 18 C10 26 16 26 16 20 C16 14 22 10 20 4 C28 10 32 20 28 28 C32 22 30 16 28 14 C34 20 34 32 20 36Z" fill="#f0883e" opacity="0.9"/></svg>`,
    render(on,c,w,h){
      const t=Date.now()/200;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      if(on){
        const cx=w/2, base=h*0.92;
        // Lueur de base
        s+=`<ellipse cx="${cx}" cy="${base}" rx="${w*0.3}" ry="${h*0.08}" fill="#f0883e" opacity="0.3"/>`;
        // 3 langues de flamme décalées
        for(let fi=0;fi<3;fi++){
          const off=(fi-1)*w*0.12;
          const flicker=Math.sin(t+fi*2.1)*0.12;
          const fh=h*(0.7+flicker+fi*0.05);
          const fw=w*(0.22-fi*0.02);
          const fc=fi===1?'#ffdd44':fi===0?'#f0883e':'#ff6020';
          const tip=base-fh;
          const cx2=cx+off;
          s+=`<path d="M${cx2-fw},${base} C${cx2-fw*1.3},${base-fh*0.4} ${cx2+fw*0.3+Math.sin(t+fi)*4},${tip+h*0.05} ${cx2},${tip} C${cx2-fw*0.3+Math.cos(t+fi)*3},${tip+h*0.05} ${cx2+fw*1.3},${base-fh*0.4} ${cx2+fw},${base}Z" fill="${fc}" opacity="${0.85-fi*0.1}"/>`;
        }
        // Cœur blanc chaud
        const hw=w*0.08, hht=h*0.25;
        s+=`<ellipse cx="${cx}" cy="${base-hht}" rx="${hw}" ry="${hht*0.4}" fill="white" opacity="0.5"/>`;
        // Brûleur en bas
        s+=`<rect x="${cx-w*0.25}" y="${base}" width="${w*0.5}" height="${h*0.08}" rx="2" fill="#333" stroke="#555" stroke-width="1"/>`;
      } else {
        // Flamme éteinte - simple brûleur
        const cx=w/2,base=h*0.85;
        s+=`<rect x="${cx-w*0.25}" y="${base}" width="${w*0.5}" height="${h*0.1}" rx="2" fill="#333" stroke="#484f58" stroke-width="1"/>`;
        s+=`<circle cx="${cx}" cy="${base-h*0.1}" r="${w*0.06}" fill="none" stroke="#484f58" stroke-width="1.5"/>`;
      }
      s+=`</svg>`;return s;}
  },
  vanne3v_motorisee:{
    label:'Vanne 3 voies motorisée',
    preview:`<svg viewBox="0 0 40 40"><polygon points="20,8 32,28 8,28" fill="none" stroke="#ff8040" stroke-width="2"/><line x1="20" y1="2" x2="20" y2="8" stroke="#ff8040" stroke-width="2"/><rect x="16" y="-2" width="8" height="5" rx="1" fill="#ff8040"/><line x1="8" y1="28" x2="2" y2="36" stroke="#ff8040" stroke-width="2"/><line x1="32" y1="28" x2="38" y2="36" stroke="#ff8040" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/1500:0;
      const pos=on?(0.5+0.5*Math.sin(t)):0;  // 0=voie A, 1=voie B
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const cx=w/2, cy=h*0.55;
      const r=Math.min(w,h)*0.28;
      // Corps triangulaire
      const p1=`${cx},${cy-r}`, p2=`${cx-r*0.87},${cy+r*0.5}`, p3=`${cx+r*0.87},${cy+r*0.5}`;
      s+=`<polygon points="${p1} ${p2} ${p3}" fill="${on?c+'18':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Tuyaux entrée/sorties
      s+=`<line x1="${cx}" y1="0" x2="${cx}" y2="${cy-r}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx-r*0.87}" y1="${cy+r*0.5}" x2="0" y2="${h*0.95}" stroke="${on?c*(pos<0.5?'':'44'):'#484f58'}" stroke-width="${h*0.08}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+r*0.87}" y1="${cy+r*0.5}" x2="${w}" y2="${h*0.95}" stroke="${on?c*(pos>0.5?'':'44'):'#484f58'}" stroke-width="${h*0.08}" stroke-linecap="round"/>`;
      // Boule obturatrice animée
      const bx=cx+Math.cos(pos*Math.PI)*r*0.3;
      const by=cy+Math.sin(pos*Math.PI)*r*0.2;
      s+=`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${r*0.22}" fill="${on?c:'#484f58'}" stroke="${on?'white':'#333'}" stroke-width="1.5"/>`;
      // Moteur électrique en haut
      const mw=w*0.3,mh=h*0.18;
      s+=`<rect x="${cx-mw/2}" y="0" width="${mw}" height="${mh}" rx="3" fill="${on?c+'33':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        const prog=(t%(Math.PI*2))/(Math.PI*2);
        s+=`<rect x="${cx-mw/2+2}" y="2" width="${(mw-4)*prog}" height="${mh-4}" rx="2" fill="${c}" opacity="0.6"/>`;
      }
      s+=`</svg>`;return s;}
  },
  vanne_motorisee:{
    label:'Vanne motorisée (2 voies)',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="20" x2="35" y2="20" stroke="#58a6ff" stroke-width="3"/><rect x="13" y="16" width="14" height="8" rx="2" fill="none" stroke="#58a6ff" stroke-width="2"/><rect x="16" y="8" width="8" height="9" rx="2" fill="#58a6ff" opacity="0.6"/><line x1="20" y1="14" x2="20" y2="16" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/800:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const cy=h/2;
      // Tuyauterie
      s+=`<line x1="0" y1="${cy}" x2="${w*0.25}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.12}" stroke-linecap="round"/>`;
      s+=`<line x1="${w*0.75}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.12}" stroke-linecap="round"/>`;
      // Corps vanne
      const vw=w*0.5,vh=h*0.4,vx=w*0.25,vy=cy-vh/2;
      s+=`<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="3" fill="${on?c+'22':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Disque interne (ouvert/fermé)
      const diskX=on?cy:cy+vh*0.3;
      s+=`<circle cx="${w*0.5}" cy="${cy}" r="${vh*0.28}" fill="${on?c+'55':'#333'}" stroke="${on?c:'#888'}" stroke-width="1.5"/>`;
      if(on) s+=`<line x1="${w*0.5-vh*0.2}" y1="${cy}" x2="${w*0.5+vh*0.2}" y2="${cy}" stroke="white" stroke-width="1.5" opacity="0.6"/>`;
      // Actionneur motorisé
      const mw=w*0.26,mh=h*0.32,mx=w*0.5-mw/2,my=vy-mh-h*0.02;
      s+=`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="3" fill="${on?c+'28':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Bargraph du moteur
      const prog=on?(0.5+0.5*Math.sin(t)):0;
      s+=`<rect x="${mx+2}" y="${my+mh-4}" width="${(mw-4)*prog}" height="3" rx="1" fill="${on?c:'#333'}"/>`;
      // Tige
      s+=`<line x1="${w*0.5}" y1="${my+mh}" x2="${w*0.5}" y2="${vy}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  chaudiere_gaz:{
    label:'Chaudière gaz',
    preview:`<svg viewBox="0 0 40 40"><rect x="8" y="6" width="24" height="28" rx="4" fill="none" stroke="#f0883e" stroke-width="2"/><path d="M16 28 C14 24 16 20 16 16 C18 20 20 20 20 16 C20 20 22 20 24 16 C24 20 26 24 24 28Z" fill="#f0883e" opacity="0.7"/></svg>`,
    render(on,c,w,h){
      const t=Date.now()/300;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Corps chaudière
      s+=`<rect x="${w*0.1}" y="${h*0.08}" width="${w*0.8}" height="${h*0.84}" rx="5" fill="${on?c+'10':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Hublot
      s+=`<circle cx="${w*0.5}" cy="${h*0.38}" r="${w*0.18}" fill="${on?'#1a0800':'#0d0d0d'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        // Flamme dans le hublot
        for(let i=0;i<3;i++){
          const fx=w*(0.38+i*0.12);
          const fh=h*(0.12+Math.sin(t+i*1.3)*0.04);
          s+=`<path d="M${fx-4},${h*0.44} C${fx-5},${h*0.38} ${fx+3},${h*0.36} ${fx},${h*0.44-fh} C${fx-3},${h*0.36} ${fx+5},${h*0.38} ${fx+4},${h*0.44}Z" fill="${i===1?'#ffdd44':'#f0883e'}" opacity="0.85"/>`;
        }
      }
      // Tuyaux raccords
      s+=`<rect x="${w*0.3}" y="${h*0.08}" width="${w*0.15}" height="${h*0.05}" rx="1" fill="${on?c:'#484f58'}"/>`;
      s+=`<rect x="${w*0.55}" y="${h*0.08}" width="${w*0.15}" height="${h*0.05}" rx="1" fill="${on?c:'#484f58'}"/>`;
      // Afficheur température
      s+=`<rect x="${w*0.25}" y="${h*0.65}" width="${w*0.5}" height="${h*0.2}" rx="2" fill="#000" stroke="${on?c+'44':'#333'}" stroke-width="1"/>`;
      const temp=on?Math.round(60+15*Math.sin(t*0.1))+'°C':'--°C';
      s+=`<text x="${w*0.5}" y="${h*0.79}" text-anchor="middle" font-family="monospace" font-size="${h*0.13}" fill="${on?c:'#484f58'}">${temp}</text>`;
      s+=`</svg>`;return s;}
  },
  surpresseur:{
    label:'Surpresseur / Compresseur',
    preview:`<svg viewBox="0 0 40 40"><ellipse cx="20" cy="22" rx="14" ry="10" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="6" y1="22" x2="2" y2="22" stroke="#58a6ff" stroke-width="2"/><line x1="34" y1="22" x2="38" y2="22" stroke="#58a6ff" stroke-width="2"/><circle cx="20" cy="22" r="5" fill="none" stroke="#58a6ff" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/400:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const cx=w*0.5,cy=h*0.55;
      // Cuve cylindrique
      s+=`<ellipse cx="${cx}" cy="${cy}" rx="${w*0.38}" ry="${h*0.28}" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Piston animé
      if(on){
        const px=cx+Math.cos(t)*w*0.15;
        const py=cy+Math.sin(t)*h*0.1;
        s+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${w*0.1}" fill="${c+'44'}" stroke="${c}" stroke-width="1.5"/>`;
        s+=`<line x1="${cx}" y1="${cy}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${c}" stroke-width="2"/>`;
      }
      // Raccords gauche/droite
      s+=`<line x1="0" y1="${cy}" x2="${cx-w*0.38}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+w*0.38}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.08}" stroke-linecap="round"/>`;
      // Jauge pression
      const pbar=on?(0.4+0.35*Math.abs(Math.sin(t*0.5))):0.1;
      s+=`<rect x="${w*0.3}" y="${h*0.1}" width="${w*0.4}" height="${h*0.12}" rx="3" fill="#0d1117" stroke="${on?c+'44':'#333'}" stroke-width="1"/>`;
      s+=`<rect x="${w*0.32}" y="${h*0.12}" width="${w*0.36*pbar}" height="${h*0.08}" rx="2" fill="${on?(pbar>0.8?'#f85149':c):'#333'}"/>`;
      s+=`</svg>`;return s;}
  },


  // ── SYMBOLES PROVIEWR / ISA-5.1 / P&ID ─────────────────────────────────

  // ─ Moteurs et entraînements ─────────────────────────────────────────────
  motor_proview:{
    label:'Moteur (ProviewR)',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13" fill="none" stroke="#58a6ff" stroke-width="2"/><text x="20" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="#58a6ff">M</text><line x1="33" y1="20" x2="40" y2="20" stroke="#58a6ff" stroke-width="3"/></svg>`,
    render(on,c,w,h){
      const cx=w*0.45,cy=h/2,r=Math.min(w*0.4,h*0.42);
      const t=on?Date.now()/250:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Cercle principal ProviewR style
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'15':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      // Lettre M
      s+=`<text x="${cx}" y="${cy+r*0.3}" text-anchor="middle" font-size="${r*0.85}" font-weight="bold" fill="${on?c:'#484f58'}">M</text>`;
      // Arbre de sortie à droite
      s+=`<line x1="${cx+r}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="3" stroke-linecap="round"/>`;
      // Bornes électriques en haut
      if(on){
        for(let i=0;i<3;i++){
          const bx=cx-r*0.3+i*r*0.3,by=cy-r;
          s+=`<line x1="${bx}" y1="${by}" x2="${bx}" y2="${by-h*0.12}" stroke="${c}" stroke-width="1.5"/>`;
        }
        // Rotation animée
        const a=t;
        const rx1=cx+r*0.55*Math.cos(a),ry1=cy+r*0.55*Math.sin(a);
        const rx2=cx+r*0.55*Math.cos(a+Math.PI),ry2=cy+r*0.55*Math.sin(a+Math.PI);
        s+=`<line x1="${rx1.toFixed(1)}" y1="${ry1.toFixed(1)}" x2="${rx2.toFixed(1)}" y2="${ry2.toFixed(1)}" stroke="${c}55" stroke-width="1.5" stroke-linecap="round"/>`;
      }
      s+=`</svg>`;return s;}
  },
  motoreducteur:{
    label:'Motoréducteur',
    preview:`<svg viewBox="0 0 40 40"><circle cx="12" cy="20" r="9" fill="none" stroke="#58a6ff" stroke-width="2"/><text x="12" y="24" text-anchor="middle" font-size="8" fill="#58a6ff">M</text><rect x="21" y="13" width="14" height="14" rx="2" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="21" y1="20" x2="23" y2="20" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/300:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const mr=h*0.3,mx=w*0.28,my=h/2;
      // Moteur (cercle)
      s+=`<circle cx="${mx}" cy="${my}" r="${mr}" fill="${on?c+'15':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<text x="${mx}" y="${my+mr*0.3}" text-anchor="middle" font-size="${mr*0.8}" font-weight="bold" fill="${on?c:'#484f58'}">M</text>`;
      // Réducteur (carré)
      const rw=w*0.34,rh=h*0.5,rx=w*0.5,ry=h*0.25;
      s+=`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="3" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Engrenage animé dans le réducteur
      if(on){
        const gx=rx+rw*0.5,gy=ry+rh*0.5,gr=rh*0.3;
        for(let i=0;i<8;i++){
          const a=t+i*Math.PI/4;
          const x1=gx+gr*0.7*Math.cos(a),y1=gy+gr*0.7*Math.sin(a);
          const x2=gx+gr*1.05*Math.cos(a),y2=gy+gr*1.05*Math.sin(a);
          s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
        }
        s+=`<circle cx="${gx}" cy="${gy}" r="${gr*0.4}" fill="${c}33" stroke="${c}" stroke-width="1"/>`;
      }
      // Raccord moteur → réducteur
      s+=`<line x1="${mx+mr}" y1="${my}" x2="${rx}" y2="${my}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      // Arbre de sortie
      s+=`<line x1="${rx+rw}" y1="${my}" x2="${w}" y2="${my}" stroke="${on?c:'#484f58'}" stroke-width="3" stroke-linecap="round"/>`;
      s+=`</svg>`;return s;}
  },
  // ─ Pompes ProviewR style ─────────────────────────────────────────────────
  pump_proview:{
    label:'Pompe (ProviewR)',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="13" fill="none" stroke="#58a6ff" stroke-width="2"/><polygon points="13,13 27,20 13,27" fill="#58a6ff"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2,r=Math.min(w,h)*0.4;
      const t=on?Date.now()/180:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'12':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      // Triangle ProviewR (pompe)
      const tx=cx-r*0.35,tw=r*0.7;
      s+=`<polygon points="${tx},${cy-r*0.55} ${tx+tw},${cy} ${tx},${cy+r*0.55}" fill="${on?c:'#484f58'}" opacity="0.85"/>`;
      if(on){
        // Rotation de la roue
        const nr=r*0.28;
        for(let i=0;i<4;i++){
          const a=t+i*Math.PI/2;
          const x1=cx+nr*0.3*Math.cos(a),y1=cy+nr*0.3*Math.sin(a);
          const x2=cx+nr*Math.cos(a),y2=cy+nr*Math.sin(a);
          s+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}88" stroke-width="1.5"/>`;
        }
      }
      // Connexions hydrauliques
      s+=`<line x1="0" y1="${cy}" x2="${cx-r}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx}" y1="0" x2="${cx}" y2="${cy-r}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`</svg>`;return s;}
  },
  // ─ Vannes P&ID standards ────────────────────────────────────────────────
  vanne_globe:{
    label:'Vanne globe (ISA)',
    preview:`<svg viewBox="0 0 40 40"><line x1="4" y1="20" x2="36" y2="20" stroke="#58a6ff" stroke-width="3"/><circle cx="20" cy="20" r="8" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="20" y1="12" x2="20" y2="4" stroke="#58a6ff" stroke-width="2"/><polygon points="16,4 24,4 20,0" fill="#58a6ff"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.55,r=h*0.26;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Tuyaux
      s+=`<line x1="0" y1="${cy}" x2="${cx-r}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+r}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      // Corps globe
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'15':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Obturateur (position selon état)
      const plug_y=on?cy-r*0.15:cy+r*0.3;
      s+=`<ellipse cx="${cx}" cy="${plug_y}" rx="${r*0.45}" ry="${r*0.2}" fill="${on?c+'66':'#555'}" stroke="${on?c:'#888'}" stroke-width="1"/>`;
      // Chapeau et tige
      s+=`<line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${h*0.18}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<rect x="${cx-r*0.6}" y="${h*0.06}" width="${r*1.2}" height="${h*0.14}" rx="2" fill="${on?c+'22':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1"/>`;
      // Volant (triangle ISA pour actionneur)
      s+=`<polygon points="${cx},${h*0.02} ${cx-r*0.6},${h*0.06} ${cx+r*0.6},${h*0.06}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  vanne_guillotine:{
    label:'Vanne guillotine (ISA)',
    preview:`<svg viewBox="0 0 40 40"><line x1="4" y1="20" x2="36" y2="20" stroke="#58a6ff" stroke-width="3"/><rect x="16" y="12" width="8" height="16" rx="1" fill="#58a6ff" opacity="0.7"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.1}" stroke-linecap="round"/>`;
      // Corps carré
      const bw=w*0.28,bh=h*0.7,bx=cx-bw/2,by=h*0.15;
      s+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2" fill="${on?c+'18':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Guillotine (monte ou descend)
      const gy=on?cy-bh*0.08:cy+bh*0.15;
      s+=`<rect x="${bx+2}" y="${gy}" width="${bw-4}" height="${bh*0.35}" rx="1" fill="${on?c:'#484f58'}" opacity="${on?0.8:0.5}"/>`;
      // Tige
      s+=`<line x1="${cx}" y1="${by}" x2="${cx}" y2="${h*0.05}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${cx-bw*0.4}" y1="${h*0.05}" x2="${cx+bw*0.4}" y2="${h*0.05}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },
  reg_pression:{
    label:'Régulateur pression',
    preview:`<svg viewBox="0 0 40 40"><line x1="4" y1="20" x2="36" y2="20" stroke="#bc8cff" stroke-width="3"/><circle cx="20" cy="20" r="8" fill="none" stroke="#bc8cff" stroke-width="2"/><line x1="20" y1="12" x2="20" y2="4" stroke="#bc8cff" stroke-width="1.5"/><circle cx="20" cy="6" r="4" fill="none" stroke="#bc8cff" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.6,r=h*0.24;
      const t=on?(Math.sin(Date.now()/1500)*0.3+0.6):0.2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${cx-r}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.09}" stroke-linecap="round"/>`;
      s+=`<line x1="${cx+r}" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.09}" stroke-linecap="round"/>`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Tige
      s+=`<line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${h*0.2}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Membrane (cercle avec pointillés)
      const mr=r*0.85;
      s+=`<circle cx="${cx}" cy="${h*0.12}" r="${mr}" fill="${on?c+'15':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5" stroke-dasharray="3,2"/>`;
      // Ressort pression
      if(on){
        for(let i=0;i<4;i++){
          const sy=h*0.12-mr+i*mr*0.5+mr*0.1;
          s+=`<path d="M${cx-mr*0.3},${sy} Q${cx+mr*0.3},${sy+mr*0.12} ${cx-mr*0.3},${sy+mr*0.25}" fill="none" stroke="${c}88" stroke-width="1"/>`;
        }
      }
      s+=`</svg>`;return s;}
  },
  // ─ Instruments de mesure P&ID ───────────────────────────────────────────
  indicateur_pid:{
    label:'Indicateur (bulle ISA)',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="22" r="12" fill="none" stroke="#d29922" stroke-width="2"/><text x="20" y="20" text-anchor="middle" font-size="7" fill="#d29922">FIC</text><text x="20" y="28" text-anchor="middle" font-size="6" fill="#d29922">001</text><line x1="20" y1="10" x2="20" y2="6" stroke="#d29922" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.56,r=Math.min(w,h)*0.36;
      const t=Date.now()/1000;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Bulle ISA
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Ligne horizontale de séparation (instrument local si pas de ligne, DCS si ligne)
      s+=`<line x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}" stroke="${on?c+'44':'#333'}" stroke-width="1" stroke-dasharray="2,2"/>`;
      // Tag instrument
      const tag=on?'FIC':'---';
      const num=on?'001':'';
      s+=`<text x="${cx}" y="${cy-r*0.12}" text-anchor="middle" font-family="monospace" font-size="${r*0.42}" font-weight="bold" fill="${on?c:'#484f58'}">${tag}</text>`;
      s+=`<text x="${cx}" y="${cy+r*0.45}" text-anchor="middle" font-family="monospace" font-size="${r*0.35}" fill="${on?c+'cc':'#484f58'}">${num}</text>`;
      // Ligne de connexion au process
      s+=`<line x1="${cx}" y1="${cy-r}" x2="${cx}" y2="${h*0.06}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Point de connexion
      s+=`<circle cx="${cx}" cy="${h*0.06}" r="${r*0.08}" fill="${on?c:'#484f58'}"/>`;
      s+=`</svg>`;return s;}
  },
  transmetteur_4_20:{
    label:'Transmetteur 4-20mA',
    preview:`<svg viewBox="0 0 40 40"><circle cx="20" cy="24" r="11" fill="none" stroke="#d29922" stroke-width="2"/><line x1="9" y1="24" x2="9" y2="24" stroke="#d29922"/><text x="20" y="22" text-anchor="middle" font-size="6" fill="#d29922">TT</text><text x="20" y="29" text-anchor="middle" font-size="5" fill="#d29922">101</text><rect x="14" y="4" width="12" height="10" rx="2" fill="none" stroke="#d29922" stroke-width="1.5"/><line x1="20" y1="14" x2="20" y2="13" stroke="#d29922" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.62,r=Math.min(w*0.38,h*0.32);
      const t=Date.now()/2000;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Bulle instrument (double cercle = transmetteur)
      s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<circle cx="${cx}" cy="${cy}" r="${r*0.85}" fill="none" stroke="${on?c+'44':'#333'}" stroke-width="0.8"/>`;
      s+=`<text x="${cx}" y="${cy-r*0.1}" text-anchor="middle" font-family="monospace" font-size="${r*0.42}" font-weight="bold" fill="${on?c:'#484f58'}">TT</text>`;
      s+=`<text x="${cx}" y="${cy+r*0.42}" text-anchor="middle" font-family="monospace" font-size="${r*0.32}" fill="${on?c+'cc':'#484f58'}">101</text>`;
      // Boîtier transmetteur (en haut)
      const bw=w*0.38,bh=h*0.22,bx=cx-bw/2,by=h*0.04;
      s+=`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="${on?c+'18':'#1a1a2a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        // Signal 4-20mA animé
        const ma=Math.round(4+16*((Math.sin(t)+1)/2));
        s+=`<text x="${cx}" y="${by+bh*0.65}" text-anchor="middle" font-family="monospace" font-size="${bh*0.38}" fill="${c}">${ma}mA</text>`;
        // Barre signal
        s+=`<rect x="${bx+2}" y="${by+bh*0.72}" width="${(bw-4)*(ma-4)/16}" height="${bh*0.2}" rx="1" fill="${c}" opacity="0.6"/>`;
      }
      s+=`<line x1="${cx}" y1="${by+bh}" x2="${cx}" y2="${cy-r}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`</svg>`;return s;}
  },
  // ─ Actionneurs et régulation ─────────────────────────────────────────────
  vanne_pneu:{
    label:'Vanne pneumatique',
    preview:`<svg viewBox="0 0 40 40"><line x1="4" y1="24" x2="36" y2="24" stroke="#58a6ff" stroke-width="3"/><polygon points="20,24 12,12 28,12" fill="none" stroke="#58a6ff" stroke-width="2"/><polygon points="20,24 12,36 28,36" fill="#58a6ff" opacity="0.7"/><circle cx="20" cy="4" r="4" fill="none" stroke="#58a6ff" stroke-width="1.5"/><line x1="20" y1="8" x2="20" y2="12" stroke="#58a6ff" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h/2;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="${h*0.09}" stroke-linecap="round"/>`;
      // Corps vanne (deux triangles ISA)
      const tr=h*0.28;
      // Triangle supérieur (corps)
      s+=`<polygon points="${cx},${cy} ${cx-tr},${cy-tr*1.4} ${cx+tr},${cy-tr*1.4}" fill="none" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Triangle inférieur (corps)
      s+=`<polygon points="${cx},${cy} ${cx-tr},${cy+tr*1.4} ${cx+tr},${cy+tr*1.4}" fill="${on?c+'33':'#1a1a1a'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Ligne horizontale séparation
      s+=`<line x1="${cx-tr}" y1="${cy}" x2="${cx+tr}" y2="${cy}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Actionneur pneumatique (cercle en haut)
      s+=`<circle cx="${cx}" cy="${h*0.1}" r="${tr*0.6}" fill="${on?c+'22':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Tige
      s+=`<line x1="${cx}" y1="${cy-tr*1.4}" x2="${cx}" y2="${h*0.1+tr*0.6}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        // Pression air animée dans le diaphragme
        const t=Date.now()/1000;
        const pr=tr*0.35+Math.sin(t*2)*tr*0.08;
        s+=`<circle cx="${cx}" cy="${h*0.1}" r="${pr}" fill="${c}" opacity="0.35"/>`;
      }
      s+=`</svg>`;return s;}
  },
  // ─ Éléments process P&ID ────────────────────────────────────────────────
  cuve_agitee:{
    label:'Cuve agitée',
    preview:`<svg viewBox="0 0 40 40"><path d="M8 12 L8 32 Q20 36 32 32 L32 12 Q20 8 8 12Z" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="20" y1="4" x2="20" y2="22" stroke="#58a6ff" stroke-width="2"/><line x1="14" y1="18" x2="26" y2="22" stroke="#58a6ff" stroke-width="2"/><line x1="14" y1="26" x2="26" y2="22" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/400:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Cuve
      s+=`<path d="M${w*0.12},${h*0.18} L${w*0.12},${h*0.82} Q${w*0.5},${h*0.95} ${w*0.88},${h*0.82} L${w*0.88},${h*0.18} Q${w*0.5},${h*0.05} ${w*0.12},${h*0.18}Z" fill="${on?c+'10':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Liquide
      if(on){
        const wave=Math.sin(t)*h*0.02;
        s+=`<path d="M${w*0.14},${h*0.52+wave} Q${w*0.35},${h*0.48+wave} ${w*0.5},${h*0.52+wave} Q${w*0.65},${h*0.56+wave} ${w*0.86},${h*0.52+wave}" fill="none" stroke="${c}55" stroke-width="1.5"/>`;
      }
      // Arbre agitateur
      s+=`<line x1="${w*0.5}" y1="0" x2="${w*0.5}" y2="${h*0.65}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      // Palettes rotatives
      const pa=t;
      const pr=w*0.22;
      for(let i=0;i<2;i++){
        const a=pa+i*Math.PI;
        const px1=w*0.5+pr*Math.cos(a),py1=h*0.65+pr*0.4*Math.sin(a);
        const px2=w*0.5+pr*Math.cos(a+Math.PI*0.15),py2=h*0.65+pr*0.4*Math.sin(a+Math.PI*0.15);
        s+=`<line x1="${w*0.5}" y1="${h*0.65}" x2="${px1.toFixed(1)}" y2="${py1.toFixed(1)}" stroke="${on?c:'#484f58'}" stroke-width="2.5" stroke-linecap="round"/>`;
      }
      s+=`</svg>`;return s;}
  },
  ejecteur:{
    label:'Éjecteur / Venturi',
    preview:`<svg viewBox="0 0 40 40"><path d="M2 16 L18 20 L2 24Z" fill="#58a6ff" opacity="0.7"/><path d="M18 20 L26 18 L38 20 L26 22Z" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="22" y1="14" x2="22" y2="18" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/300:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      const cy=h/2;
      // Corps venturi (tuyère)
      s+=`<path d="M0,${cy-h*0.22} L${w*0.4},${cy-h*0.1} L${w*0.65},${cy-h*0.18} L${w},${cy-h*0.12} L${w},${cy+h*0.12} L${w*0.65},${cy+h*0.18} L${w*0.4},${cy+h*0.1} L0,${cy+h*0.22}Z" fill="${on?c+'12':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        // Flux animé
        for(let i=0;i<4;i++){
          const phase=(t*0.8+i*0.25)%1;
          const fx=phase*w*0.95;
          const fy_range=h*0.08*(1-Math.abs(fx/w-0.5)*1.5);
          s+=`<circle cx="${fx.toFixed(1)}" cy="${cy}" r="${fy_range>1?1:fy_range}" fill="${c}" opacity="${0.6-i*0.1}"/>`;
        }
      }
      // Prise de pression (tube perpendiculaire)
      s+=`<line x1="${w*0.52}" y1="${cy-h*0.15}" x2="${w*0.52}" y2="${h*0.08}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`<line x1="${w*0.42}" y1="${h*0.08}" x2="${w*0.62}" y2="${h*0.08}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      s+=`</svg>`;return s;}
  },
  // ─ Sécurité et protection ────────────────────────────────────────────────
  soupape_securite:{
    label:'Soupape de sécurité',
    preview:`<svg viewBox="0 0 40 40"><line x1="5" y1="24" x2="35" y2="24" stroke="#f85149" stroke-width="3"/><polygon points="20,24 12,12 28,12" fill="#f85149" opacity="0.8"/><line x1="20" y1="12" x2="20" y2="6" stroke="#f85149" stroke-width="2"/><line x1="16" y1="6" x2="24" y2="6" stroke="#f85149" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const cx=w/2,cy=h*0.6;
      const t=on?Date.now()/200:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${on?'#f85149':'#484f58'}" stroke-width="${h*0.09}" stroke-linecap="round"/>`;
      // Triangle ISA soupape
      const tr=h*0.3;
      s+=`<polygon points="${cx},${cy} ${cx-tr},${cy-tr*1.3} ${cx+tr},${cy-tr*1.3}" fill="${on?'#f8514933':'#1a1a1a'}" stroke="${on?'#f85149':'#484f58'}" stroke-width="1.5"/>`;
      // Ressort taré
      const spring_y=cy-tr*1.3;
      if(on){
        // Soupape qui s'ouvre (vibration)
        const vib=Math.sin(t*3)*h*0.02;
        s+=`<line x1="${cx-tr*0.4}" y1="${spring_y+vib}" x2="${cx+tr*0.4}" y2="${spring_y+vib}" stroke="#f85149" stroke-width="2.5"/>`;
        // Jet de vapeur
        for(let i=0;i<3;i++){
          const jt=(t*0.4+i*0.33)%1;
          const jx=cx+(i-1)*w*0.12;
          const jy=spring_y-jt*h*0.25;
          s+=`<circle cx="${jx}" cy="${jy}" r="${jt*4+1}" fill="#f85149" opacity="${0.6-jt*0.5}"/>`;
        }
      } else {
        s+=`<line x1="${cx-tr*0.4}" y1="${spring_y}" x2="${cx+tr*0.4}" y2="${spring_y}" stroke="#484f58" stroke-width="2"/>`;
      }
      // Tige et ressort
      s+=`<line x1="${cx}" y1="${spring_y}" x2="${cx}" y2="${h*0.12}" stroke="${on?'#f85149':'#484f58'}" stroke-width="1.5"/>`;
      s+=`<line x1="${cx-tr*0.6}" y1="${h*0.12}" x2="${cx+tr*0.6}" y2="${h*0.12}" stroke="${on?'#f85149':'#484f58'}" stroke-width="2.5"/>`;
      s+=`</svg>`;return s;}
  },
  // ─ Utilités ─────────────────────────────────────────────────────────────
  tour_refroidissement:{
    label:'Tour de refroidissement',
    preview:`<svg viewBox="0 0 40 40"><path d="M8 8 L12 32 L28 32 L32 8 Q20 14 8 8Z" fill="none" stroke="#58a6ff" stroke-width="2"/><line x1="20" y1="8" x2="20" y2="18" stroke="#58a6ff" stroke-width="1.5"/><path d="M14 14 Q20 18 26 14" fill="none" stroke="#58a6ff" stroke-width="1.5"/></svg>`,
    render(on,c,w,h){
      const t=on?Date.now()/600:0;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      // Corps tour hyperboloïde
      s+=`<path d="M${w*0.12},${h*0.1} Q${w*0.5},${h*0.35} ${w*0.88},${h*0.1} L${w*0.78},${h*0.88} L${w*0.22},${h*0.88}Z" fill="${on?c+'10':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      if(on){
        // Gouttelettes d'eau tombantes
        for(let i=0;i<5;i++){
          const phase=(t*0.5+i*0.2)%1;
          const dx=w*(0.25+i*0.12);
          const dy=h*(0.4+phase*0.4);
          s+=`<ellipse cx="${dx}" cy="${dy}" rx="1.5" ry="${2+phase*2}" fill="${c}" opacity="${0.6-phase*0.3}"/>`;
        }
        // Vapeur en haut
        for(let i=0;i<3;i++){
          const vt=(t*0.3+i*0.33)%1;
          const vx=w*(0.35+i*0.15);
          const vy=h*(0.1-vt*0.15);
          const vr=vt*8+3;
          s+=`<circle cx="${vx}" cy="${vy}" r="${vr}" fill="white" opacity="${0.15-vt*0.1}"/>`;
        }
      }
      // Ventilateur en haut
      s+=`<circle cx="${w*0.5}" cy="${h*0.22}" r="${w*0.15}" fill="none" stroke="${on?c:'#484f58'}" stroke-width="1.5" stroke-dasharray="4,2"/>`;
      // Bassins en bas
      s+=`<rect x="${w*0.2}" y="${h*0.85}" width="${w*0.6}" height="${h*0.1}" rx="2" fill="${on?c+'22':'#111'}" stroke="${on?c:'#484f58'}" stroke-width="1"/>`;
      s+=`</svg>`;return s;}
  },
  groupe_froid:{
    label:'Groupe froid / Chiller',
    preview:`<svg viewBox="0 0 40 40"><rect x="6" y="8" width="28" height="24" rx="4" fill="none" stroke="#58a6ff" stroke-width="2"/><text x="20" y="22" text-anchor="middle" font-size="9" fill="#58a6ff">❄</text><line x1="6" y1="20" x2="2" y2="20" stroke="#58a6ff" stroke-width="2"/><line x1="34" y1="20" x2="38" y2="20" stroke="#58a6ff" stroke-width="2"/></svg>`,
    render(on,c,w,h){
      const t=Date.now()/800;
      let s=`<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
      s+=`<rect x="${w*0.08}" y="${h*0.1}" width="${w*0.84}" height="${h*0.8}" rx="5" fill="${on?c+'12':'#0d1117'}" stroke="${on?c:'#484f58'}" stroke-width="1.5"/>`;
      // Symbole flocon animé
      if(on){
        const cx2=w/2,cy2=h/2,fr=h*0.25;
        const a=t*0.5;
        for(let i=0;i<6;i++){
          const ia=a+i*Math.PI/3;
          const x2=cx2+fr*Math.cos(ia),y2=cy2+fr*Math.sin(ia);
          s+=`<line x1="${cx2}" y1="${cy2}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="2"/>`;
          // Branches
          const bx=cx2+fr*0.55*Math.cos(ia),by=cy2+fr*0.55*Math.sin(ia);
          for(const d of [-1,1]){
            const ba=ia+d*Math.PI/4;
            s+=`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(bx+fr*0.2*Math.cos(ba)).toFixed(1)}" y2="${(by+fr*0.2*Math.sin(ba)).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
          }
        }
        s+=`<circle cx="${cx2}" cy="${cy2}" r="${fr*0.15}" fill="${c}"/>`;
      } else {
        s+=`<text x="${w*0.5}" y="${h*0.6}" text-anchor="middle" font-size="${h*0.3}" fill="#484f58">❄</text>`;
      }
      // Raccords
      s+=`<line x1="0" y1="${h*0.35}" x2="${w*0.08}" y2="${h*0.35}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="0" y1="${h*0.65}" x2="${w*0.08}" y2="${h*0.65}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.92}" y1="${h*0.35}" x2="${w}" y2="${h*0.35}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`<line x1="${w*0.92}" y1="${h*0.65}" x2="${w}" y2="${h*0.65}" stroke="${on?c:'#484f58'}" stroke-width="2"/>`;
      s+=`</svg>`;return s;}
  },

  // ══ BALLON ECS — 2 sondes de température + consigne ══
  ballon_ecs:{
    label:'Ballon ECS (2 sondes)',
    defaultProps:{colorCold:'#1a6aff', colorHot:'#f85149'},
    preview:`<svg viewBox="0 0 40 56" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pg_prev" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stop-color="#1a6aff"/>
          <stop offset="50%"  stop-color="#f0883e"/>
          <stop offset="100%" stop-color="#f85149"/>
        </linearGradient>
        <clipPath id="cp_prev2"><rect x="7" y="4" width="26" height="44" rx="4"/></clipPath>
      </defs>
      <rect x="7" y="4" width="26" height="44" rx="4" fill="#0d1117"/>
      <rect x="7" y="4" width="26" height="44" rx="4" fill="url(#pg_prev)" clip-path="url(#cp_prev2)"/>
      <ellipse cx="20" cy="4"  rx="13" ry="5" fill="#161b22" stroke="#f85149" stroke-width="1.2"/>
      <ellipse cx="20" cy="48" rx="13" ry="5" fill="#161b22" stroke="#1a6aff" stroke-width="1.2"/>
      <rect x="7" y="4" width="26" height="44" rx="4" fill="none" stroke="#f85149" stroke-width="1.2"/>
      <text x="20" y="22" text-anchor="middle" font-size="6" font-weight="bold" fill="white" font-family="monospace">55&#176;</text>
      <text x="20" y="38" text-anchor="middle" font-size="6" font-weight="bold" fill="white" font-family="monospace">28&#176;</text>
    </svg>`,
    render(on,c,pw,ph,wgt){
      // ─── Lectures PLC ────────────────────────────────────────────────────
      const tHaut   = wgt&&wgt.dvTempHaut ? getV(wgt.dvTempHaut) : null;
      const tBas    = wgt&&wgt.dvTempBas  ? getV(wgt.dvTempBas)  : null;
      const consRaw = wgt&&wgt.dvConsigne ? getV(wgt.dvConsigne)  : null;
      const consigne= consRaw!=null ? parseFloat(consRaw) : parseFloat(wgt&&wgt.consigneVal||60);

      // ─── Couleurs personnalisables du dégradé ────────────────────────────
      const CC = (wgt&&wgt.colorCold)||'#1a6aff';   // couleur eau froide
      const CH = (wgt&&wgt.colorHot) ||'#f85149';   // couleur eau chaude

      // Interpolation via color-mix(in oklch) : blending perceptuellement uniforme
      const t2col=(t)=>{
        if(t===null||t===undefined||isNaN(parseFloat(t))) return CC;
        const r=Math.max(0,Math.min(1,(parseFloat(t)-10)/Math.max(1,consigne-10)));
        const pct=Math.round(r*100);
        return `color-mix(in oklch,${CH} ${pct}%,${CC})`;
      };

      // ─── Valeurs dérivées ────────────────────────────────────────────────
      const uid       = `b${Math.round((wgt&&wgt.x)||0)}_${Math.round((wgt&&wgt.y)||0)}`;
      const atConsigne= tHaut!==null && parseFloat(tHaut)>=consigne-3;
      const bdColor   = atConsigne?CH:'#30363d';
      const tHStr     = tHaut!==null ? `${parseFloat(tHaut).toFixed(1)}°` : '--°';
      const tBStr     = tBas !==null ? `${parseFloat(tBas ).toFixed(1)}°` : '--°';
      const conStr    = `${parseFloat(consigne).toFixed(0)}°C`;
      const cTop      = t2col(tHaut);
      const cMid      = t2col(tHaut!==null&&tBas!==null?(parseFloat(tHaut)+parseFloat(tBas))/2:null);
      const cBot      = t2col(tBas);
      const cLblH     = tHaut!==null ? t2col(tHaut) : '#8b949e';
      const cLblB     = tBas !==null ? t2col(tBas)  : '#8b949e';

      // Ligne de front thermique Y (dans corp y=13..119)
      const htRatio= tHaut!==null?Math.max(0,Math.min(1,(parseFloat(tHaut)-10)/Math.max(1,consigne-10))):0;
      const frontY = Math.round(119-(htRatio*106));

      // ─── SVG — viewBox sans tuyaux ni raccords ───────────────────────────
      return`<svg viewBox="0 0 84 138" xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}" style="display:block;">
        <defs>
          <linearGradient id="wg_${uid}" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%"   stop-color="${cBot}" stop-opacity="0.97"/>
            <stop offset="50%"  stop-color="${cMid}" stop-opacity="0.97"/>
            <stop offset="100%" stop-color="${cTop}" stop-opacity="0.97"/>
          </linearGradient>
          <clipPath id="bc_${uid}"><rect x="15" y="13" width="54" height="106" rx="7"/></clipPath>
          <filter id="glow_${uid}" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        <!-- Corps ballon -->
        <rect x="15" y="13" width="54" height="106" rx="7" fill="#080d12"/>
        <rect x="15" y="13" width="54" height="106" rx="7" fill="url(#wg_${uid})"/>
        <!-- Reflet lateral 3D -->
        <rect x="16" y="15" width="5" height="102" rx="2.5" fill="white" opacity="0.035"/>

        <!-- Ligne de front thermique (stratification) -->
        ${tHaut!==null&&tBas!==null&&Math.abs(parseFloat(tHaut)-parseFloat(tBas))>3
          ?`<line x1="15" y1="${frontY}" x2="69" y2="${frontY}" stroke="white" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.22" clip-path="url(#bc_${uid})"/>`
          :''}

        <!-- Calottes bombees -->
        <ellipse cx="42" cy="13"  rx="27" ry="9" fill="#111820" stroke="${bdColor}" stroke-width="1.8"/>
        <ellipse cx="42" cy="119" rx="27" ry="9" fill="#111820" stroke="${bdColor}" stroke-width="1.5"/>
        <rect x="15" y="13" width="54" height="106" rx="7" fill="none" stroke="${bdColor}" stroke-width="1.8"/>

        <!-- T sonde HAUTE -->
        <text x="42" y="37" text-anchor="middle" font-size="15" font-weight="bold"
              fill="${cLblH}" font-family="monospace" opacity="0.97"
              ${atConsigne?`filter="url(#glow_${uid})"`:''}>${tHStr}</text>
        <text x="42" y="48" text-anchor="middle" font-size="7" fill="white"
              font-family="sans-serif" opacity="0.45">&#9650; sonde haute</text>

        <!-- SP consigne centre -->
        <text x="42" y="72" text-anchor="middle" font-size="8.5" fill="white"
              font-family="monospace" opacity="0.15" font-weight="bold">ECS</text>
        <text x="42" y="83" text-anchor="middle" font-size="7.5"
              fill="${atConsigne?'#ffd740':'#8b949e'}" font-family="monospace"
              opacity="${atConsigne?0.9:0.5}">SP ${conStr}</text>

        <!-- T sonde BASSE -->
        <text x="42" y="100" text-anchor="middle" font-size="15" font-weight="bold"
              fill="${cLblB}" font-family="monospace" opacity="0.90">${tBStr}</text>
        <text x="42" y="111" text-anchor="middle" font-size="7" fill="white"
              font-family="sans-serif" opacity="0.45">&#9660; sonde basse</text>

        <!-- Pastille consigne atteinte -->
        ${atConsigne
          ?`<circle cx="42" cy="6" r="4.5" fill="${CH}" opacity="0.9"/>
            <text x="42" y="9.5" text-anchor="middle" font-size="5.5" fill="white" font-weight="bold">&#10003;</text>`
          :''}
      </svg>`;
    }
  }

};

// ── Rendu widget animé (SVG inline dans #widgets-html) ────────────────
function rAnim(w,val,canvasOnly){
  const on=!!val;
  const def=ANIM_SYMBOLS[w.animId];
  if(!def){
    // Placeholder si animId inconnu
    ctx.fillStyle=_bg3();rr(ctx,w.x,w.y,w.w,w.h,8);ctx.fill();
    ctx.fillStyle='#484f58';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(w.animId||'?',w.x+w.w/2,w.y+w.h/2);
    return;
  }
  const co=on?(w.colorOn||'#f0883e'):(w.colorOff||'#484f58');
  // Injecter le SVG animé dans #widgets-html (visible en opérateur, semi-transparent en édition)
  const d=document.createElement('div');
  const _animRot=w.angle?`rotate(${(w.angle*180/Math.PI).toFixed(2)}deg)`:'';
  d.style.cssText=`position:absolute;left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px;overflow:hidden;pointer-events:none;transform-origin:center center;transform:${_animRot};`;
  // En mode édition : afficher le SVG à 60% d'opacité + cadre de sélection canvas
  d.style.opacity = editMode ? '0.6' : '1';
  d.innerHTML=def.render(on,co,w.w,w.h,w);
  const _hd=_activeHtmlDiv||document.getElementById('widgets-html');
  if(!_hd||canvasOnly) return;
  _hd.appendChild(d);
  // En mode édition : cadre pointillé coloré + badge type + dimensions
  if(editMode){
    const isSel = selected===w;
    // Cadre
    ctx.strokeStyle = isSel ? '#f0883e' : '#58a6ff';
    ctx.lineWidth   = isSel ? 2 : 1;
    ctx.setLineDash([4,3]);
    rr(ctx,w.x,w.y,w.w,w.h,8); ctx.stroke();
    ctx.setLineDash([]);
    // Badge type en haut à gauche
    const badge='⚡ '+def.label;
    ctx.fillStyle='rgba(13,31,53,0.82)';
    const bw=ctx.measureText(badge).width+10;
    ctx.fillRect(w.x+2,w.y+2,bw,16);
    ctx.fillStyle='#58a6ff'; ctx.font='bold 9px sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(badge,w.x+7,w.y+4);
    // Dimensions en bas à droite
    const dim=`${w.w}×${w.h}`;
    ctx.fillStyle='rgba(13,31,53,0.82)';
    const dw=ctx.measureText(dim).width+8;
    ctx.fillRect(w.x+w.w-dw-2,w.y+w.h-16,dw,14);
    ctx.fillStyle='#8b949e'; ctx.font='8px sans-serif';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    ctx.fillText(dim,w.x+w.w-4,w.y+w.h-3);
    // 4 poignées de redimensionnement
    const cCol = isSel ? '#f0883e' : '#58a6ff';
    _drawHandles(w, isSel);
  }
  // Label sous le widget
  if(w.label){
    ctx.fillStyle='#8b949e';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.textBaseline='top';
    ctx.fillText(w.label,w.x+w.w/2,w.y+w.h+2);
  }
}
function _updateRtBuf(s){
  const now=Date.now();
  Object.entries(s.analog||{}).forEach(([id,v])=>{
    if(!rtBuffers[id])rtBuffers[id]=[];
    const t=v.celsius;
    if(t!=null&&!isNaN(t)){rtBuffers[id].push({x:now,y:t});if(rtBuffers[id].length>RT_MAX)rtBuffers[id].shift();}
  });
  Object.entries(s.registers||{}).forEach(([id,v])=>{
    if(!rtBuffers[id])rtBuffers[id]=[];
    rtBuffers[id].push({x:now,y:parseFloat(v)||0});
    if(rtBuffers[id].length>RT_MAX)rtBuffers[id].shift();
  });
  // AV nommées — aussi disponibles pour le widget Tendance
  Object.entries(s.av_vars||{}).forEach(([id,v])=>{
    if(!rtBuffers[id])rtBuffers[id]=[];
    rtBuffers[id].push({x:now,y:parseFloat(v)||0});
    if(rtBuffers[id].length>RT_MAX)rtBuffers[id].shift();
  });
}

// ═══════════════ DRAG & DROP ═══════════════
document.querySelectorAll('.sb-item[data-type]').forEach(el=>{
  el.addEventListener('dragstart',e=>{_dragType=el.dataset.type;_dragSym=null;_dragImgId=null;e.dataTransfer.effectAllowed='copy';});
});
cvs.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
cvs.addEventListener('drop',e=>{
  e.preventDefault();if(!editMode)return;
  const x=_snap(e.offsetX),y=_snap(e.offsetY);
  if(_dragType){const w=mkW(_dragType,x,y);widgets.push(w);selected=w;showProps(w);renderAll();_dirty=true;_dragType=null;}
  else if(_dragSym){
    let w;
    if(_dragSym.type==='animated'){
      const animDef=ANIM_SYMBOLS[_dragSym.animId];
      const extra=animDef&&animDef.defaultProps ? {...animDef.defaultProps} : {};
      w=mkW('animated',x,y,{animId:_dragSym.animId,label:_dragSym.label,...extra});
    } else {
      w=mkW('symbol',x,y,{symId:_dragSym.symId,label:_dragSym.label});
    }
    widgets.push(w);selected=w;showProps(w);renderAll();_dirty=true;_dragSym=null;
  }
  else if(_dragImgId){const img=userImages.find(i=>i.id===_dragImgId);const w=mkW('image',x,y,{imageId:_dragImgId,label:img?.name.replace(/\.[^.]+$/,'')||''});widgets.push(w);selected=w;showProps(w);renderAll();_dirty=true;_dragImgId=null;}
});

// ═══════════════ SOURIS ═══════════════
let _drag=null,_rsz=null,_rszDir=null,_rszOrig=null,_dox=0,_doy=0,_multiSel=new Set(),_rubber=null,_rubberStart=null,_dragGroup=false,_prevMx=0,_prevMy=0,_groupStartPos=null,_groupDragDx=0,_groupDragDy=0;
// ─── Rotation par poignée ───
let _rot=null,_rotStartAngle=0,_rotOrigAngle=0;
cvs.addEventListener('mousedown',e=>{
  if(!editMode)return;
  const mx=e.offsetX,my=e.offsetY;
  // ── Poignée de rotation ──
  if(selected&&_multiSel.size===0&&!selected.locked){
    const rh=_rotHandlePos(selected);
    if(Math.hypot(mx-rh.x,my-rh.y)<=12){
      _rot=selected;
      const cx=selected.x+selected.w/2, cy=selected.y+selected.h/2;
      _rotStartAngle=Math.atan2(my-cy,mx-cx);
      _rotOrigAngle=selected.angle||0;
      return;
    }
  }
  // 4 coins de redimensionnement — zone de détection 16px
  if(selected&&_multiSel.size===0&&!selected.locked){
    const s=selected, CS=16;
    const corners=[
      {dir:'nw', cx:s.x,     cy:s.y},
      {dir:'ne', cx:s.x+s.w, cy:s.y},
      {dir:'sw', cx:s.x,     cy:s.y+s.h},
      {dir:'se', cx:s.x+s.w, cy:s.y+s.h},
    ];
    for(const c of corners){
      if(mx>=c.cx-CS&&mx<=c.cx+CS&&my>=c.cy-CS&&my<=c.cy+CS){
        _rsz=s; _rszDir=c.dir;
        _rszOrig={x:s.x,y:s.y,w:s.w,h:s.h,mx,my};
        return;
      }
    }
  }
  // Détection clic : les éléments verrouillés sont sélectionnables (propriétés) mais non déplaçables
  const hit=[...widgets].reverse().find(w=>mx>=w.x&&mx<=w.x+w.w&&my>=w.y&&my<=w.y+w.h);
  if(hit){
    if(e.ctrlKey||e.metaKey){
      // Ctrl+clic : toggle multi-sélection (locked exclus du groupe)
      if(!hit.locked){
        if(_multiSel.has(hit)) _multiSel.delete(hit);
        else { _multiSel.add(hit); if(selected&&selected!==hit&&!selected.locked) _multiSel.add(selected); }
      }
      selected=hit; showProps(hit); renderAll(); return;
    }
    // Clic sur un widget déjà dans le groupe → drag groupe
    if(!hit.locked&&_multiSel.size>0&&_multiSel.has(hit)){
      _drag=hit;_dragGroup=true;_prevMx=mx;_prevMy=my;
      _groupStartPos=new Map([..._multiSel].map(w=>[w,[w.x,w.y]]));
      _groupDragDx=0;_groupDragDy=0;
      renderAll();return;
    }
    // Sélection simple — verrouillé : sélection seule, pas de drag
    _multiSel.clear();_dragGroup=false;
    selected=hit;
    if(!hit.locked){ _drag=hit;_dox=mx-hit.x;_doy=my-hit.y; }
    showProps(hit);renderAll();
  } else {
    if(!e.ctrlKey&&!e.metaKey){ _multiSel.clear(); selected=null; showProps(null); }
    // Démarrer rubber-band
    _rubberStart={x:mx,y:my}; _rubber=null;
    renderAll();
  }
});
cvs.addEventListener('mousemove',e=>{
  if(!editMode)return;
  const mx=e.offsetX,my=e.offsetY;
  // ── Rotation en cours ──
  if(_rot){
    const cx=_rot.x+_rot.w/2, cy=_rot.y+_rot.h/2;
    const curAngle=Math.atan2(my-cy,mx-cx);
    let newAngle=_rotOrigAngle+(curAngle-_rotStartAngle);
    // Snap à 15° si Shift maintenu
    if(e.shiftKey) newAngle=Math.round(newAngle/(Math.PI/12))*(Math.PI/12);
    _rot.angle=newAngle;
    // Mettre à jour le champ angle dans le panneau propriétés
    const el=document.querySelector('[data-key="angle"]');
    if(el) el.value=Math.round(newAngle*180/Math.PI);
    renderAll();_dirty=true;return;
  }
  if(_rsz&&_rszDir&&_rszOrig){
    const dx=mx-_rszOrig.mx, dy=my-_rszOrig.my;
    const o=_rszOrig;
    if(_rszDir==='se'){ _rsz.w=Math.max(20,_snap(o.w+dx)); _rsz.h=Math.max(10,_snap(o.h+dy)); }
    else if(_rszDir==='sw'){ const nw=Math.max(20,_snap(o.w-dx)); _rsz.x=_snap(o.x+o.w-nw); _rsz.w=nw; _rsz.h=Math.max(10,_snap(o.h+dy)); }
    else if(_rszDir==='ne'){ _rsz.w=Math.max(20,_snap(o.w+dx)); const nh=Math.max(10,_snap(o.h-dy)); _rsz.y=_snap(o.y+o.h-nh); _rsz.h=nh; }
    else if(_rszDir==='nw'){ const nw=Math.max(20,_snap(o.w-dx)); _rsz.x=_snap(o.x+o.w-nw); _rsz.w=nw; const nh=Math.max(10,_snap(o.h-dy)); _rsz.y=_snap(o.y+o.h-nh); _rsz.h=nh; }
    // Mettre à jour les champs x/y/w/h dans le panneau propriétés
    ['x','y','w','h'].forEach(k=>{const el=document.querySelector('[data-key="'+k+'"]');if(el)el.value=_rsz[k];});
    renderAll();_dirty=true;return;
  }
  if(_drag){
    if(_dragGroup&&_multiSel.size>0&&_groupStartPos){
      _groupDragDx+=mx-_prevMx; _groupDragDy+=my-_prevMy;
      _prevMx=mx; _prevMy=my;
      _groupStartPos.forEach(([sx,sy],w)=>{
        w.x=_snap(sx+_groupDragDx);
        w.y=_snap(sy+_groupDragDy);
      });
    } else {
      _drag.x=_snap(mx-_dox);_drag.y=_snap(my-_doy);
      const xe=document.querySelector('[data-key="x"]'),ye=document.querySelector('[data-key="y"]');
      if(xe)xe.value=_drag.x;if(ye)ye.value=_drag.y;
    }
    renderAll();_dirty=true;return;
  }
  if(_rubberStart){
    _rubber={x:Math.min(mx,_rubberStart.x),y:Math.min(my,_rubberStart.y),
             w:Math.abs(mx-_rubberStart.x),h:Math.abs(my-_rubberStart.y)};
    renderAll();
  }
  // Curseur
  if(_rot){ cvs.style.cursor='crosshair'; }
  else if(_rsz&&_rszDir){ const map={nw:'nw-resize',ne:'ne-resize',sw:'sw-resize',se:'se-resize'}; cvs.style.cursor=map[_rszDir]||'se-resize'; }
  else if(_drag) cvs.style.cursor='grabbing';
  else if(_rubberStart) cvs.style.cursor='crosshair';
  else {
    const hover=[...widgets].reverse().find(w=>mx>=w.x&&mx<=w.x+w.w&&my>=w.y&&my<=w.y+w.h);
  // Curseur sur les 4 coins (AVANT la détection hover — coins peuvent être hors du widget)
  if(selected&&_multiSel.size===0&&!_drag&&!_rsz&&!_rot){
    const s=selected, CS=16;
    // Poignée de rotation
    const rh=_rotHandlePos(s);
    if(Math.hypot(mx-rh.x,my-rh.y)<=12){ cvs.style.cursor='grab'; return; }
    if(mx>=s.x-CS&&mx<=s.x+CS&&my>=s.y-CS&&my<=s.y+CS)        {cvs.style.cursor='nw-resize';}
    else if(mx>=s.x+s.w-CS&&mx<=s.x+s.w+CS&&my>=s.y-CS&&my<=s.y+CS) {cvs.style.cursor='ne-resize';}
    else if(mx>=s.x-CS&&mx<=s.x+CS&&my>=s.y+s.h-CS&&my<=s.y+s.h+CS) {cvs.style.cursor='sw-resize';}
    else if(mx>=s.x+s.w-CS&&mx<=s.x+s.w+CS&&my>=s.y+s.h-CS&&my<=s.y+s.h+CS) {cvs.style.cursor='se-resize';}
    else {
      // Pas sur un coin — laisser le code hover gérer le curseur
      const hover=[...widgets].reverse().find(w=>mx>=w.x&&mx<=w.x+w.w&&my>=w.y&&my<=w.y+w.h);
      if(hover){cvs.style.cursor=hover.locked?'pointer':((_multiSel.size>0&&_multiSel.has(hover))?'move':'grab');}
      else cvs.style.cursor='default';
    }
    return;
  }
  if(hover){
    cvs.style.cursor=hover.locked?'pointer':((_multiSel.size>0&&_multiSel.has(hover))?'move':'grab');
    } else {
      cvs.style.cursor='default';
    }
  }
});
cvs.addEventListener('mouseup',e=>{
  if(_rubber&&_rubberStart){
    // Sélectionner les widgets dans le rectangle
    const {x,y,w,h}=_rubber;
    _multiSel=new Set(widgets.filter(wg=>
      wg.x+wg.w>x&&wg.x<x+w&&wg.y+wg.h>y&&wg.y<y+h
    ));
    if(_multiSel.size===1){selected=[..._multiSel][0];showProps(selected);_multiSel.clear();}
    else if(_multiSel.size===0){selected=null;showProps(null);}
    else{selected=null;showProps(null);}
    renderAll();
  }
  // Toujours remettre à zéro rubber-band (même si simple clic sans mouvement)
  _rubber=null;_rubberStart=null;
  _drag=null;_rsz=null;_rszDir=null;_rszOrig=null;_dragGroup=false;_groupStartPos=null;_groupDragDx=0;_groupDragDy=0;
  _rot=null;_rotStartAngle=0;_rotOrigAngle=0;
  cvs.style.cursor='default';
});

// ═══════════════ CLAVIER ═══════════════
// ── Presse-papier interne synoptique ─────────────────────────────────────
let _synClipboard = null;

let _synClipboardGroup = null;
function copySel(){
  if(!editMode)return;
  if(_multiSel.size>1){
    _synClipboardGroup=[..._multiSel].map(w=>JSON.parse(JSON.stringify(w)));
    _synClipboard=null;
    const fl=document.getElementById('syn-copy-flash');
    if(fl){fl.textContent=`✔ Copié : ${_multiSel.size} widgets`;fl.style.opacity='1';setTimeout(()=>fl.style.opacity='0',1200);}
    return;
  }
  _synClipboardGroup=null;
  if(!selected)return;
  _synClipboard = JSON.parse(JSON.stringify(selected));
  const fl=document.getElementById('syn-copy-flash');
  if(fl){fl.textContent=`✔ Copié : ${selected.type}`;fl.style.opacity='1';setTimeout(()=>fl.style.opacity='0',1200);}
}
function pasteSel(){
  if(!editMode)return;
  if(_synClipboardGroup){
    const newWs=_synClipboardGroup.map(w=>{const c=JSON.parse(JSON.stringify(w));c.id='W'+(idCounter++);c.x+=GRID;c.y+=GRID;return c;});
    newWs.forEach(w=>widgets.push(w));
    _multiSel=new Set(newWs);selected=null;showProps(null);renderAll();_dirty=true;return;
  }
  if(!_synClipboard)return;
  const c=JSON.parse(JSON.stringify(_synClipboard));
  c.id='W'+(idCounter++);c.x+=GRID;c.y+=GRID;
  widgets.push(c);selected=c;showProps(c);renderAll();_dirty=true;
}

document.addEventListener('keydown',e=>{
  const a=document.activeElement.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(a))return;
  if((e.key==='Delete'||e.key==='Backspace')&&editMode&&!(selected&&selected.locked)){
    if(_multiSel.size>1){widgets=widgets.filter(w=>!_multiSel.has(w));_multiSel.clear();selected=null;showProps(null);renderAll();_dirty=true;}
    else if(selected){widgets=widgets.filter(w=>w!==selected);selected=null;showProps(null);renderAll();_dirty=true;}
  }
  if(e.ctrlKey&&(e.key==='a'||e.key==='A')&&editMode){e.preventDefault();_multiSel=new Set(widgets.filter(w=>!w.locked));selected=null;showProps(null);renderAll();}
  if(e.ctrlKey&&(e.key==='l'||e.key==='L')&&editMode){e.preventDefault();if(selected){selected.locked=!selected.locked;renderAll();_dirty=true;toast(selected.locked?'🔒 Verrouillé':'🔓 Déverrouillé','ok');}}
  if(e.ctrlKey&&e.key==='d'&&selected&&editMode){e.preventDefault();dupSel();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();saveSynoptic();}
  if(e.ctrlKey&&(e.key==='c'||e.key==='C')&&editMode){e.preventDefault();copySel();}
  if(e.ctrlKey&&(e.key==='v'||e.key==='V')&&editMode){e.preventDefault();pasteSel();}
  if(editMode){let dx=0,dy=0;if(e.key==='ArrowLeft')dx=-GRID;if(e.key==='ArrowRight')dx=GRID;if(e.key==='ArrowUp')dy=-GRID;if(e.key==='ArrowDown')dy=GRID;if(dx||dy){
    if(_multiSel.size>1){_multiSel.forEach(w=>{w.x+=dx;w.y+=dy;});}
    else if(selected){selected.x+=dx;selected.y+=dy;}
    renderAll();_dirty=true;e.preventDefault();}}
});

// ═══════════════ OPÉRATIONS ═══════════════
function dupSel(){if(!selected||!editMode)return;const c=JSON.parse(JSON.stringify(selected));c.id='W'+(idCounter++);c.x+=GRID;c.y+=GRID;widgets.push(c);selected=c;showProps(c);renderAll();_dirty=true;}
function duplicateSelected(){dupSel();}
function bringToFront(){if(!selected)return;widgets=widgets.filter(w=>w!==selected);widgets.push(selected);renderAll();}
function sendToBack(){if(!selected)return;widgets=widgets.filter(w=>w!==selected);widgets.unshift(selected);renderAll();}
function clearCanvas(){if(!confirm('Effacer tous les widgets ?'))return;widgets=[];selected=null;showProps(null);renderAll();_dirty=true;}
function alignLeft(){if(!selected)return;const ref=selected.x;widgets.filter(w=>w!==selected).forEach(w=>{w.x=ref;});renderAll();_dirty=true;}
function alignVCenter(){if(!selected)return;const cx=selected.x+selected.w/2;widgets.filter(w=>w!==selected).forEach(w=>{w.x=cx-w.w/2;});renderAll();_dirty=true;}
function alignTop(){if(!selected)return;const ref=selected.y;widgets.filter(w=>w!==selected).forEach(w=>{w.y=ref;});renderAll();_dirty=true;}

// ═══════════════ SAUVEGARDE ═══════════════
function saveSynoptic(){
  // Sauvegarder GRID/bgColor dans la page active avant export
  pg().grid=GRID; pg().background=bgColor;
  // Format multi-pages (compatible avec synoptic.html côté RPi)
  const json=JSON.stringify({pages,curPage,images:userImages,showNavBar});
  cb('on_synoptic_saved',json);_dirty=false;toast('💾 Sauvegardé','ok');
}

// ═══════════════ TOOLBAR ═══════════════
// applyMode() applique l'état visuel (sidebar/toolbar/bouton/taille canvas)
// correspondant à la valeur ACTUELLE de editMode, de façon idempotente :
// on peut l'appeler autant de fois qu'on veut, elle remet toujours le DOM
// en cohérence avec editMode (contrairement à l'ancien toggleMode() qui
// supposait que le DOM était déjà synchronisé avec editMode avant de basculer).
function applyMode(){
  renderPagesBar();
  // Toolbar principale (mode édition uniquement)
  const tb=document.getElementById('toolbar');
  if(tb){ editMode ? tb.classList.add('visible') : tb.classList.remove('visible'); }
  // Barre de navigation : toujours visible en mode opérateur, cachée en mode édition
  const navBar=document.getElementById('nav-fixed-bar');
  const navToggleBtn=document.getElementById('nav-bar-toggle');
  if(!editMode){
    // Mode opérateur → forcer la nav bar visible
    showNavBar=true;
    if(navBar) navBar.className='visible';
    if(navToggleBtn) navToggleBtn.className='tbtn on';
  } else {
    // Mode édition → cacher la nav bar (selon préférence)
    if(!showNavBar && navBar) navBar.className='';
  }
  renderNavFixed();
  // Badge mode (dans toolbar)
  const b=document.getElementById('editBadge');
  if(b){
    b.textContent=editMode?'✏ Edition':'👁 Operateur';
    b.className='mode-badge '+(editMode?'edit':'view');
  }
  // Bouton dans barre nav fixe (toujours visible)
  const eb=document.getElementById('edit-mode-btn');
  if(eb){
    eb.textContent=editMode?'👁 Opérateur':'✏ Édition';
    eb.style.borderColor = editMode ? 'var(--amber)' : 'var(--accent)';
    eb.style.color       = editMode ? 'var(--amber)' : 'var(--accent)';
  }
  // Sidebar & props
  const sb=document.getElementById('sidebar');
  const pp=document.getElementById('propsPanel');
  if(editMode){sb&&sb.classList.remove('hidden');pp&&pp.classList.remove('hidden');}
  else{sb&&sb.classList.add('hidden');pp&&pp.classList.add('hidden');selected=null;showProps(null);}
  // Le masquage/affichage de la sidebar et du panneau propriétés change la
  // largeur dispo de #canvasWrap : on recalcule la taille du canvas
  // maintenant que le DOM a la bonne classe (sinon le canvas garde sa
  // taille figée et laisse un vide à droite/en bas en mode opérateur).
  _resize();
}
function toggleMode(){
  editMode=!editMode;
  applyMode();
}
function toggleGrid(){
  showGrid=!showGrid;
  const btn=document.getElementById('gridBtn');
  if(showGrid)btn.classList.add('active'); else btn.classList.remove('active');
  renderAll();
}

// ═══════════════ PROPRIÉTÉS ═══════════════
function showPageProps(){
  const hint=document.getElementById('no-sel-hint');
  const area=document.getElementById('page-props-area');
  if(!hint||!area)return;
  hint.style.display='none';
  area.style.display='block';
  const p=pg();
  const hasBg=!!p.bgImage;
  const opVal=(p.bgImageOpacity??0.8);
  const fitVal=p.bgImageFit||'cover';
  area.innerHTML=`
    <div class="props-hdr" style="margin:-8px -8px 8px;padding:6px 10px;font-size:9px;font-weight:700;background:var(--bg2);border-bottom:1px solid var(--border);letter-spacing:.5px;">📄 PAGE — ${p.name}</div>

    <div class="prop-section">Fond de couleur</div>
    <div class="prop-row">
      <div class="prop-label">Couleur</div>
      <input type="color" class="prop-input prop-color" value="${bgColor||'#0d1117'}"
        onchange="bgColor=this.value;pg().background=bgColor;renderAll();_dirty=true;">
    </div>

    <div class="prop-section" style="color:#bc8cff">🖼 Image de fond</div>
    ${hasBg ? `
    <div style="padding:4px 0;font-size:9px;color:var(--green)">✓ Image définie</div>
    <div class="prop-row">
      <div class="prop-label">Ajustement</div>
      <select class="prop-input" onchange="pg().bgImageFit=this.value;renderAll();_dirty=true;">
        <option value="cover"   ${fitVal==='cover'  ?'selected':''}>Remplir (cover)</option>
        <option value="contain" ${fitVal==='contain'?'selected':''}>Contenu (contain)</option>
        <option value="stretch" ${fitVal==='stretch'?'selected':''}>Étiré</option>
      </select>
    </div>
    <div class="prop-row">
      <div class="prop-label">Opacité</div>
      <div style="display:flex;gap:4px;align-items:center;width:100%;">
        <input type="range" min="0.05" max="1" step="0.05" value="${opVal.toFixed(2)}"
          style="flex:1;accent-color:#7c3aed;"
          oninput="pg().bgImageOpacity=parseFloat(this.value);document.getElementById('bg-op-val').textContent=Math.round(parseFloat(this.value)*100)+'%';renderAll();_dirty=true;">
        <span id="bg-op-val" style="font-size:10px;color:#bc8cff;width:32px;text-align:right">${Math.round(opVal*100)}%</span>
      </div>
    </div>
    <div style="display:flex;gap:4px;margin-top:6px;">
      <button class="tbtn" style="flex:1;font-size:10px;border-color:#7c3aed;color:#bc8cff;" onclick="_openBgImagePicker()">🔄 Changer</button>
      <button class="tbtn" style="flex:1;font-size:10px;border-color:#f85149;color:#f85149;" onclick="clearBgImage()">✕ Supprimer</button>
    </div>` : `
    <div style="padding:4px 0;font-size:9px;color:var(--text3)">Aucune image de fond.</div>
    <button class="tbtn" style="width:100%;margin-top:4px;border-color:#7c3aed;color:#bc8cff;font-size:11px;" onclick="_openBgImagePicker()">📁 Choisir une image…</button>`}

    <div class="prop-section" style="margin-top:10px;">Grille</div>
    <div class="prop-row">
      <div class="prop-label">Taille</div>
      <select class="prop-input" onchange="setSynGrid(parseInt(this.value))">
        ${[5,10,20,40].map(v=>`<option value="${v}" ${GRID===v?'selected':''}>${v} px</option>`).join('')}
      </select>
    </div>

    <div class="prop-section" style="margin-top:10px;color:#58a6ff">🍓 RPI distant</div>
    <div class="prop-row">
      <div class="prop-label">IP:Port</div>
      <input type="text" class="prop-input" id="rpi-url-input"
        placeholder="192.168.1.50:5000"
        value="${_rpiUrl.replace('http://','')}"
        style="font-family:monospace;font-size:10px;"
        onchange="window.setRpiUrl(this.value?'http://'+this.value.replace(/^https?:\/\//,''):'')"
        onkeydown="if(event.key==='Enter')window.setRpiUrl(this.value?'http://'+this.value.replace(/^https?:\/\//,''):'')">
    </div>
    <div style="font-size:9px;color:var(--text3);padding:3px 0 6px;">
      Les actions (boutons, curseurs…) seront envoyées<br>en temps réel au RPI via son API HTTP.
    </div>
    <div style="margin-top:6px;font-size:9px;color:var(--text3);">
      Double-clic sur l'onglet pour renommer la page.
    </div>
  `;
}

function showProps(w){
  const body=document.getElementById('propsBody');
  if(!w){body.innerHTML='<div class="no-sel">Cliquer sur un widget pour éditer ses propriétés.<br><br>Glisser depuis la palette pour ajouter.</div>';return;}
  const an=Array.from({length:12},(_,i)=>`ANA${i}`).map(r=>`<option value="${r}" ${w.varRef===r?'selected':''}>${r}${_SYNOPTIC_ANA_NAMES[r]?' — '+_SYNOPTIC_ANA_NAMES[r]:''}</option>`).join('');
  // FIX: RF0..RF255 (auto-câblés RF100+) avec saisie libre
  const _rfAll=Array.from({length:512},(_,i)=>`RF${i}`);
  const _rfWithCurrent=(val,arr)=>{if(!val||arr.includes(val))return arr;return[val,...arr];};
  // Génère un champ texte + datalist (saisie libre ET auto-complétion RF0..RF255)
  // Datalist RF partagé (une seule fois dans le DOM — évite gel avec 256 options × N)
  const _SYN_RF_DL='syn-rf-global-dl';
  if(!document.getElementById(_SYN_RF_DL)){
    const _dl=document.createElement('datalist');_dl.id=_SYN_RF_DL;
    for(let _i=0;_i<512;_i++){const _o=document.createElement('option');_o.value=`RF${_i}`;_dl.appendChild(_o);}
    document.body.appendChild(_dl);
  }
  // rf = champ texte libre + datalist partagé (widgets RF-only)
  const rf=`<input class="prop-input" type="text" list="${_SYN_RF_DL}" data-key="varRef" value="${w.varRef||''}" placeholder="ex: RF0, RF168, RF512…" style="width:100%;box-sizing:border-box">`;
  // rfOpts = <option> pour <select> (temperature/gauge/bar — liste déroulante)
  const rfOpts=_rfWithCurrent(w.varRef,_rfAll).map(r=>`<option value="${r}" ${w.varRef===r?'selected':''}>${r}</option>`).join('');
  const rfFor=(key)=>`<input class="prop-input" type="text" list="${_SYN_RF_DL}" data-key="${key}" value="${w[key]||''}" placeholder="ex: RF0, RF168, RF512…" style="width:100%;box-sizing:border-box">`;;
  // ── rfComboFor : liste déroulante RF0-RF255 + saisie libre — pour clés RF pures (varSP, varDep, varRet…)
  const rfComboFor=(key)=>{
    const _cv=w[key]||'';
    const _extra=(_cv&&!_rfAll.includes(_cv))?`<option value="${_cv}" selected>${_cv}</option>`:'';
    const _opts=_extra+`<option value="">—</option>`+_rfAll.map(r=>`<option value="${r}" ${_cv===r?'selected':''}>${r}</option>`).join('');
    return `<select class="prop-input" data-key="${key}">${_opts}</select></div>`
      +`<div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>`
      +`<input class="prop-input" type="text" list="${_SYN_RF_DL}" data-key="${key}" value="${_cv}" placeholder="ex: RF0, RF168, RF512…" style="width:100%;box-sizing:border-box">`;
  };
  // ── rfAnComboFor : liste ANA + RF + saisie libre — pour clés mixtes (T° ambiante, capteur…)
  const rfAnComboFor=(key)=>{
    const _cv=w[key]||'';
    const _anOpts=Array.from({length:12},(_,i)=>`ANA${i}`).map(r=>`<option value="${r}" ${_cv===r?'selected':''}>${r}${_SYNOPTIC_ANA_NAMES[r]?' — '+_SYNOPTIC_ANA_NAMES[r]:''}</option>`).join('');
    const _extra=(_cv&&!_rfAll.includes(_cv)&&!_cv.startsWith('ANA'))?`<option value="${_cv}" selected>${_cv}</option>`:'';
    const _rfOpts=_extra+_rfAll.map(r=>`<option value="${r}" ${_cv===r?'selected':''}>${r}</option>`).join('');
    return `<select class="prop-input" data-key="${key}"><option value="">—</option><optgroup label="Températures">${_anOpts}</optgroup><optgroup label="Registres RF">${_rfOpts}</optgroup></select></div>`
      +`<div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>`
      +`<input class="prop-input" type="text" list="${_SYN_RF_DL}" data-key="${key}" value="${_cv}" placeholder="ex: ANA0, RF0, RF168…" style="width:100%;box-sizing:border-box">`;
  };
  const mb=Array.from({length:16},(_,i)=>`M${i}`).map(r=>`<option value="${r}" ${w.varRef===r?'selected':''}>${r}</option>`).join('');
  // Helpers pour selects utilisant une clé autre que varRef (varSP, varDep, varRet…)
  const anFor=(key)=>Array.from({length:12},(_,i)=>`ANA${i}`).map(r=>`<option value="${r}" ${w[key]===r?'selected':''}>${r}${_SYNOPTIC_ANA_NAMES[r]?' — '+_SYNOPTIC_ANA_NAMES[r]:''}</option>`).join('');
  // Liste GPIO dynamique — mise à jour par setGpioConfig() depuis le studio
  const _gpNames = Object.keys(_SYNOPTIC_GPIO_NAMES).length
    ? _SYNOPTIC_GPIO_NAMES
    : {5:"Sortie K1",11:"Sortie K2",9:"Sortie K3",10:"Sortie K4",22:"Sortie K5",27:"Sortie K6",17:"Sortie K7",4:"Sortie K8",6:"Sortie K9",13:"Sortie K10",19:"Sortie K11",26:"Sortie K12",21:"Sortie K13",20:"Sortie K14",16:"Sortie K15",12:"Sortie K16"};
  // Pins triés par numéro Kx dans le nom — fallback = ordre K1→K16 carte relais standard
  const _rawPins = _SYNOPTIC_GPIO_OUT.length
    ? _SYNOPTIC_GPIO_OUT
    : [5, 11, 9, 10, 22, 27, 17, 4, 6, 13, 19, 26, 21, 20, 16, 12];
  const _gpPins = [..._rawPins].sort((a,b)=>{
    const na=_gpNames[a]||'', nb=_gpNames[b]||'';
    const ma=na.match(/K(\d+)/i), mb_=nb.match(/K(\d+)/i);
    if(ma&&mb_) return parseInt(ma[1])-parseInt(mb_[1]);
    if(ma) return -1; if(mb_) return 1;
    return a-b;
  });
  const gp=_gpPins.map(p=>`<option value="${p}" ${w.varRef==p||w.varRef==String(p)?'selected':''}>${_gpNames[p]||'GPIO'+p} (GPIO${p})</option>`).join('');
  // GPIO IN — entrées physiques (boutons, capteurs TOR…)
  const gpIn=_SYNOPTIC_GPIO_IN.map(p=>`<option value="${p}" ${w.varRef==p||w.varRef==String(p)?'selected':''}>${_SYNOPTIC_GPIO_NAMES[p]||'GPIO'+p} (GPIO${p})</option>`).join('');
  let h=`<div class="prop-section">Position / Taille</div>`;
  h+=pN('x','X',w.x)+pN('y','Y',w.y)+pN('w','Larg.',w.w)+pN('h','Haut.',w.h);
  // Rotation
  h+=`<div class="prop-row"><div class="prop-label">🔄 Rotation °</div>
    <input type="number" class="prop-input" data-key="angle-deg"
      min="-360" max="360" step="1"
      value="${Math.round((w.angle||0)*180/Math.PI)}"
      onchange="selected.angle=parseFloat(this.value)*Math.PI/180;renderAll();_dirty=true;">
    </div>`;
  h+=`<label class="chk-row" style="display:flex;align-items:center;gap:6px;padding:5px 0;cursor:pointer;border-top:1px solid var(--border);margin-top:4px;">
    <input type="checkbox" ${w.locked?'checked':''} onchange="selected.locked=this.checked;renderAll();_dirty=true;">
    <span style="font-size:11px;">🔒 Verrouiller (ne bouge plus)</span>
  </label>`;
  if(!['label','symbol','image','dyn_text'].includes(w.type))h+=`<div class="prop-section">Général</div>`+pT('label','Étiquette',w.label||'');
  if(['temperature','gauge','bar','trend','trend_db','value'].includes(w.type)){h+=`<div class="prop-section">Variable PLC</div><div class="prop-row"><div class="prop-label">Référence</div><select class="prop-input" data-key="varRef"><optgroup label="Températures">${an}</optgroup><optgroup label="Registres RF">${rfOpts}</optgroup></select></div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>${rf}</div>`;if(!['trend','trend_db'].includes(w.type))h+=pT('unit','Unité',w.unit||'°C');h+=pC('color','Couleur',w.color||'#58a6ff')+pC('bg','Fond',w.bg||'#0d1117');if(w.type==='temperature'){h+=`<div class="prop-section">Alarmes</div>`+pN('alarmHigh','Seuil haut',w.alarmHigh??85,'','')+pN('alarmLow','Seuil bas',w.alarmLow??3,'','');}if(['gauge','bar'].includes(w.type)){h+=`<div class="prop-section">Échelle</div>`+pN('min','Min',w.min??0)+pN('max','Max',w.max??100);}if(w.type==='trend_db'){h+=`<div class="prop-section">Historique</div>`+pN('hours','Fenêtre (h)',w.hours??24,1,8760,1)+`<div class="prop-row" style="font-size:10px;color:var(--t3)">Échantillonné côté serveur toutes les 5 min, conservé 1 an. La référence ci-dessus est détectée automatiquement par le moteur PLC dès l'enregistrement de la page.</div>`;}}
  if(w.type==='numeric'){
    h+=`<div class="prop-section">Registre RF / Variable</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Registre RF</div>
      <select class="prop-input" data-key="varRef">${rfOpts}</select>
      </div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">Saisie libre (RF>255…)</div>
      ${rf}</div>`;
    h+=pT('unit','Unité',w.unit||'');
    h+=pN('decimals','Décimales',w.decimals??1,'0','4','1');
    h+=pC('color','Couleur valeur',w.color||'#58a6ff');
    h+=pC('bg','Fond',w.bg||'#0d1117');
  }
  if(w.type==='av_display'){
    h+=`<div class="prop-section">Variable AV / RF</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Nom variable</div><input class="prop-input" data-key="varRef" type="text" value="${w.varRef||'av0'}" placeholder="ex: av0, temp_interieur, RF0…"></div>`;
    h+=pT('label','Libellé',w.label||'Variable');
    h+=pT('unit','Unité',w.unit||'');
    h+=pN('decimals','Décimales',w.decimals??2);
    h+=pC('color','Couleur valeur',w.color||'#ffa030');
    h+=pC('bg','Fond',w.bg||'#1a1000');
  }
  if(w.type==='relay'){
  const _isRelayGpio = w.varRef && /^\d+$/.test(String(w.varRef));
  h+=`<div class="prop-section">Cible du relais</div>
  <div class="prop-row"><div class="prop-label">Mode</div>
    <select class="prop-input" onchange="
      const g=this.value==='gpio';
      document.getElementById('rel-gpio-row').style.display=g?'flex':'none';
      document.getElementById('rel-dv-row').style.display=g?'none':'flex';
    ">
      <option value="dv" ${!_isRelayGpio?'selected':''}>Variable DV/BACKUP (nommée)</option>
      <option value="gpio" ${_isRelayGpio?'selected':''}>Pin GPIO (numéro)</option>
    </select></div>
  <div class="prop-row" id="rel-dv-row" style="display:${_isRelayGpio?'none':'flex'}">
    <div class="prop-label">Nom variable</div>
    <input type="text" class="prop-input" data-key="varRef"
      value="${!_isRelayGpio?w.varRef:''}" placeholder="ex: k_pompe"
      style="font-family:monospace;font-size:11px;"></div>
  <div class="prop-row" id="rel-gpio-row" style="display:${_isRelayGpio?'flex':'none'}">
    <div class="prop-label">Broche GPIO</div>
    <select class="prop-input" data-key="varRef">${gp}</select></div>`
  +pT('onLabel','Texte ON',w.onLabel||'ACTIF')
  +pT('offLabel','Texte OFF',w.offLabel||'inactif')
  +pC('color','Couleur ON',w.color||'#3fb950');
}
  if(w.type==='setpoint'){
    const isAVsp = w.varRef && !w.varRef.startsWith('RF') && !/^M\d+$/.test(w.varRef) && isNaN(parseInt(w.varRef))  // FIX;
    h+=`<div class="prop-section">Consigne</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" id="sp-type-sel" onchange="
        const av=this.value==='av';
        document.getElementById('sp-rf-row').style.display=av?'none':'flex';
        document.getElementById('sp-av-row').style.display=av?'flex':'none';">
        <option value="rf" ${!isAVsp?'selected':''}>Registre RF</option>
        <option value="av" ${isAVsp?'selected':''}>Variable AV (nommée)</option>
      </select></div>`;
    h+=`<div class="prop-row" id="sp-rf-row" style="display:${isAVsp?'none':'flex'}">
      <div class="prop-label">Registre RF</div>
      <select class="prop-input" data-key="varRef">${rfOpts}</select>
      </div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">Saisie libre (RF>255…)</div>
      ${rf}</div>`;
    h+=`<div class="prop-row" id="sp-av-row" style="display:${isAVsp?'flex':'none'}">
      <div class="prop-label">Nom variable AV</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${isAVsp?w.varRef:''}" placeholder="ex: consigne_salon"
        style="font-family:monospace;font-size:11px;"></div>`;
    h+=pT('unit','Unité',w.unit||'°C')+pN('min','Min',w.min??0)+pN('max','Max',w.max??100)+pN('step','Pas',w.step??0.5)+pC('color','Couleur',w.color||'#d29922');
  }
  if(w.type==='numentry'){
    // varRef peut être RF0..RF15 OU un nom de variable AV (ex: "temp_interieur")
    const isAV = w.varRef && !w.varRef.startsWith('RF') && !/^M\d+$/.test(w.varRef) && isNaN(parseInt(w.varRef))  // FIX;
    h+=`<div class="prop-section">Saisie numérique</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" id="ne-type-sel" onchange="
        const av=this.value==='av';
        document.getElementById('ne-rf-row').style.display=av?'none':'flex';
        document.getElementById('ne-av-row').style.display=av?'flex':'none';
      ">
        <option value="rf" ${!isAV?'selected':''}>Registre RF</option>
        <option value="av" ${isAV?'selected':''}>Variable AV (nommée)</option>
      </select></div>`;
    h+=`<div class="prop-row" id="ne-rf-row" style="display:${isAV?'none':'flex'}">
      <div class="prop-label">Registre RF</div>
      <select class="prop-input" data-key="varRef">${rfOpts}</select>
      </div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">Saisie libre (RF>255…)</div>
      ${rf}</div>`;
    h+=`<div class="prop-row" id="ne-av-row" style="display:${isAV?'flex':'none'}">
      <div class="prop-label">Nom variable AV</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${isAV?w.varRef:''}" placeholder="ex: temp_interieur"
        style="font-family:monospace;font-size:11px;"></div>`;
    h+=pT('unit','Unité',w.unit||'°C')+pN('min','Min',w.min??0)+pN('max','Max',w.max??100)+pN('step','Pas',w.step??1)+pN('decimals','Décimales',w.decimals??1,'0','4','1')+pC('color','Couleur',w.color||'#e06c75');
  }
  if(w.type==='button'){h+=`<div class="prop-section">Action</div><div class="prop-row"><div class="prop-label">Type</div><select class="prop-input" data-key="action"><option value="plc_start" ${w.action==='plc_start'?'selected':''}>▶ Démarrer PLC</option><option value="plc_stop" ${w.action==='plc_stop'?'selected':''}>■ Arrêter PLC</option><option value="set_mem" ${w.action==='set_mem'?'selected':''}>M→1</option><option value="reset_mem" ${w.action==='reset_mem'?'selected':''}>M→0</option><option value="set_dv" ${w.action==='set_dv'?'selected':''}>DV→true (marche)</option><option value="reset_dv" ${w.action==='reset_dv'?'selected':''}>DV→false (arrêt)</option><option value="pulse_dv" ${w.action==='pulse_dv'?'selected':''}>DV impulsion (200ms)</option></select></div>`;
  if(['set_mem','reset_mem'].includes(w.action))
    h+=`<div class="prop-row"><div class="prop-label">Bit M</div><select class="prop-input" data-key="varRef">${mb}</select></div>`;
  if(['set_dv','reset_dv','pulse_dv'].includes(w.action))
    h+=`<div class="prop-row"><div class="prop-label">Nom variable</div><input type="text" class="prop-input" data-key="varRef" value="${w.varRef||''}" placeholder="ex: marche_pompe" style="font-family:monospace;font-size:11px;"></div>`;
  h+=pC('color','Couleur',w.color||'#58a6ff')+pC('bg','Fond',w.bg||'#1a2f45')+`<div class="prop-section">Style bouton</div><div class="prop-row"><div class="prop-label">Enjoliveur</div><select class="prop-input" data-key="btnStyle"><option value="flat" ${(w.btnStyle||'flat')==='flat'?'selected':''}>Plat</option><option value="raised" ${w.btnStyle==='raised'?'selected':''}>Relief 3D</option><option value="neon" ${w.btnStyle==='neon'?'selected':''}>Néon lumineux</option><option value="industrial" ${w.btnStyle==='industrial'?'selected':''}>Industriel (rivets)</option><option value="pill" ${w.btnStyle==='pill'?'selected':''}>Pilule</option></select></div>`;}
  if(w.type==='toggle'){
  const _isMt = w.varRef && /^M\d+$/.test(String(w.varRef));  // FIX: Mardi != M-bit
  h+=`<div class="prop-section">Variable cible</div>`
  +`<div class="prop-row"><div class="prop-label">Type cible</div>
    <select class="prop-input" onchange="
      const m=this.value==='mem';
      document.getElementById('tog-m-row').style.display=m?'flex':'none';
      document.getElementById('tog-dv-row').style.display=m?'none':'flex';
    ">
      <option value="dv" ${!_isMt?'selected':''}>Variable DV/BACKUP (nommée)</option>
      <option value="mem" ${_isMt?'selected':''}>Bit M</option>
    </select></div>`
  +`<div class="prop-row" id="tog-dv-row" style="display:${_isMt?'none':'flex'}">
    <div class="prop-label">Nom variable</div>
    <input type="text" class="prop-input" data-key="varRef"
      value="${!_isMt?w.varRef:''}" placeholder="ex: mode_auto"
      style="font-family:monospace;font-size:11px;"></div>`
  +`<div class="prop-row" id="tog-m-row" style="display:${_isMt?'flex':'none'}">
    <div class="prop-label">Bit M</div>
    <select class="prop-input" data-key="varRef">${mb}</select></div>`
  +pC('color','Couleur',w.color||'#bc8cff')
  +`<div class="prop-section">Style</div><div class="prop-row"><div class="prop-label">Enjoliveur</div><select class="prop-input" data-key="btnStyle"><option value="flat" ${(w.btnStyle||'flat')==='flat'?'selected':''}>Plat</option><option value="raised" ${w.btnStyle==='raised'?'selected':''}>Relief 3D</option><option value="neon" ${w.btnStyle==='neon'?'selected':''}>Néon</option></select></div>`;}

  if(w.type==='temp_card'){
    h+=`<div class="prop-section">Variable PLC</div>
    <div class="prop-row"><div class="prop-label">Sonde</div><select class="prop-input" data-key="varRef"><optgroup label="Températures">${an}</optgroup><optgroup label="Registres RF">${rfOpts}</optgroup></select></div>
    <div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>${rf}</div>`
    +pT('unit','Unité',w.unit||'°C')
    +`<div class="prop-section">Alarmes</div>`+pN('alarmHigh','Seuil haut',w.alarmHigh??85)+pN('alarmLow','Seuil bas',w.alarmLow??3)
    +pC('color','Couleur accent',w.color||'#e53935')
    +pC('bgCard','Fond carte',w.bgCard||'#ffffff')
    +pC('textColor','Texte',w.textColor||'#1a1a2e');
  }
  if(w.type==='sp_card'){
    const isAVsc = w.varRef && !w.varRef.startsWith('RF') && !/^M\d+$/.test(w.varRef) && isNaN(parseInt(w.varRef))  // FIX;
    h+=`<div class="prop-section">Consigne carte</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" id="sc-type-sel" onchange="
        const av=this.value==='av';
        document.getElementById('sc-rf-row').style.display=av?'none':'flex';
        document.getElementById('sc-av-row').style.display=av?'flex':'none';">
        <option value="rf" ${!isAVsc?'selected':''}>Registre RF</option>
        <option value="av" ${isAVsc?'selected':''}>Variable AV (nommée)</option>
      </select></div>`;
    h+=`<div class="prop-row" id="sc-rf-row" style="display:${isAVsc?'none':'flex'}">
      <div class="prop-label">Registre RF</div>
      <select class="prop-input" data-key="varRef">${rfOpts}</select>
      </div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">Saisie libre (RF>255…)</div>
      ${rf}</div>`;
    h+=`<div class="prop-row" id="sc-av-row" style="display:${isAVsc?'flex':'none'}">
      <div class="prop-label">Nom variable AV</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${isAVsc?w.varRef:''}" placeholder="ex: consigne_plancher"
        style="font-family:monospace;font-size:11px;"></div>`;
    h+=pT('unit','Unité',w.unit||'°C')
    +pN('min','Min',w.min??0)+pN('max','Max',w.max??100)+pN('step','Pas',w.step??0.5)
    +pC('color','Couleur accent',w.color||'#1565c0')
    +pC('bgCard','Fond carte',w.bgCard||'#ffffff');
  }
  if(w.type==='push_3d'){
    h+=`<div class="prop-section">Variable DV</div>
    <div class="prop-row"><div class="prop-label">Var DV</div><input class="prop-input" data-key="varRef" value="${w.varRef||''}"></div>`
    +pC('color','Couleur ON',w.color||'#22c55e')
    +pC('colorOff','Couleur OFF',w.colorOff||'#374151')
    +`<div class="prop-row"><div class="prop-label">Type</div><select class="prop-input" data-key="momentary"><option value="true" ${w.momentary!==false?'selected':''}>Poussoir (momentané)</option><option value="false" ${w.momentary===false?'selected':''}>Toggle (maintenu)</option></select></div>`;
  }
  if(w.type==='toggle_btn_3d'){
    h+=`<div class="prop-section" style="color:#60a5fa">⏻ Bouton 3D ON/OFF</div>
    <div class="prop-row"><div class="prop-label">Var DV</div><input class="prop-input" data-key="varRef" value="${w.varRef||''}"></div>`
    +pC('color','Couleur ON',w.color||'#22c55e')
    +pC('colorOff','Couleur OFF',w.colorOff||'#374151')
    +pT('onLabel','Texte ON',w.onLabel||'ON')
    +pT('offLabel','Texte OFF',w.offLabel||'OFF')
    +`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0;line-height:1.6">
      1er clic → ON · 2e clic → OFF<br>Écrit dans la variable DV nommée
    </div>`;
  }
  if(w.type==='toggle_3d'){
    const _isMt3 = w.varRef && /^M\d+$/.test(String(w.varRef));  // FIX
    h+=`<div class="prop-section">Variable cible</div>`
    +`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" onchange="
        const m=this.value==='mem';
        document.getElementById('t3-m-row').style.display=m?'flex':'none';
        document.getElementById('t3-dv-row').style.display=m?'none':'flex';
      ">
        <option value="dv" ${!_isMt3?'selected':''}>Variable DV/BACKUP (nommée)</option>
        <option value="mem" ${_isMt3?'selected':''}>Bit M</option>
      </select></div>`
    +`<div class="prop-row" id="t3-dv-row" style="display:${_isMt3?'none':'flex'}">
      <div class="prop-label">Nom variable</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${!_isMt3?w.varRef:''}" placeholder="ex: mode_chauf"
        style="font-family:monospace;font-size:11px;"></div>`
    +`<div class="prop-row" id="t3-m-row" style="display:${_isMt3?'flex':'none'}">
      <div class="prop-label">Bit M</div>
      <select class="prop-input" data-key="varRef">${mb}</select></div>`
    +pC('color','Couleur ON',w.color||'#3b82f6')
    +pC('colorOff','Couleur OFF',w.colorOff||'#374151')
    +pT('onLabel','Texte ON',w.onLabel||'ON')
    +pT('offLabel','Texte OFF',w.offLabel||'OFF');
  }
  if(w.type==='btn_3d'){
    h+=`<div class="prop-section">Action</div>
    <div class="prop-row"><div class="prop-label">Type</div><select class="prop-input" data-key="action">
      <option value="plc_start" ${w.action==='plc_start'?'selected':''}>▶ Démarrer PLC</option>
      <option value="plc_stop"  ${w.action==='plc_stop'?'selected':''}>■ Arrêter PLC</option>
      <option value="set_mem"   ${w.action==='set_mem'?'selected':''}>M→1</option>
      <option value="reset_mem" ${w.action==='reset_mem'?'selected':''}>M→0</option>
      <option value="set_dv"   ${w.action==='set_dv'?'selected':''}>DV→true (marche)</option>
      <option value="reset_dv" ${w.action==='reset_dv'?'selected':''}>DV→false (arrêt)</option>
      <option value="pulse_dv" ${w.action==='pulse_dv'?'selected':''}>DV impulsion (200ms)</option>
    </select></div>`;
    if(['set_mem','reset_mem'].includes(w.action))
      h+=`<div class="prop-row"><div class="prop-label">Bit M</div><select class="prop-input" data-key="varRef">${mb}</select></div>`;
    if(['set_dv','reset_dv','pulse_dv'].includes(w.action))
      h+=`<div class="prop-row"><div class="prop-label">Nom variable</div><input type="text" class="prop-input" data-key="varRef" value="${w.varRef||''}" placeholder="ex: marche_pompe" style="font-family:monospace;font-size:11px;"></div>`;
    h+=pC('color','Couleur',w.color||'#3b82f6');
  }
  if(w.type==='dv_push'){
    const isDvM = w.varRef && /^M\d+$/.test(w.varRef);  // FIX: 'Mardi' != M-bit
    h+=`<div class="prop-section">Bouton poussoir DV</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" onchange="
        const m=this.value==='mem';
        document.getElementById('dvp-m-row').style.display=m?'flex':'none';
        document.getElementById('dvp-dv-row').style.display=m?'none':'flex';
      ">
        <option value="dv" ${!isDvM?'selected':''}>Variable DV (nommée)</option>
        <option value="mem" ${isDvM?'selected':''}>Bit M</option>
      </select></div>`;
    h+=`<div class="prop-row" id="dvp-dv-row" style="display:${isDvM?'none':'flex'}">
      <div class="prop-label">Nom variable DV</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${!isDvM?w.varRef:''}" placeholder="ex: marche_pompe"
        style="font-family:monospace;font-size:11px;"></div>`;
    h+=`<div class="prop-row" id="dvp-m-row" style="display:${isDvM?'flex':'none'}">
      <div class="prop-label">Bit M</div>
      <select class="prop-input" data-key="varRef">${mb}</select></div>`;
    h+=pC('color','Couleur actif',w.color||'#f0883e')+pC('colorOff','Couleur inactif',w.colorOff||'#484f58');
  }

  if(w.type==='dv_toggle'){
    const isDvMt = w.varRef && /^M\d+$/.test(w.varRef);  // FIX: 'Mercredi' != M-bit
    h+=`<div class="prop-section">Interrupteur DV</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Type cible</div>
      <select class="prop-input" onchange="
        const m=this.value==='mem';
        document.getElementById('dvt-m-row').style.display=m?'flex':'none';
        document.getElementById('dvt-dv-row').style.display=m?'none':'flex';
      ">
        <option value="dv" ${!isDvMt?'selected':''}>Variable DV (nommée)</option>
        <option value="mem" ${isDvMt?'selected':''}>Bit M</option>
      </select></div>`;
    h+=`<div class="prop-row" id="dvt-dv-row" style="display:${isDvMt?'none':'flex'}">
      <div class="prop-label">Nom variable DV</div>
      <input type="text" class="prop-input" data-key="varRef"
        value="${!isDvMt?w.varRef:''}" placeholder="ex: mode_auto"
        style="font-family:monospace;font-size:11px;"></div>`;
    h+=`<div class="prop-row" id="dvt-m-row" style="display:${isDvMt?'flex':'none'}">
      <div class="prop-label">Bit M</div>
      <select class="prop-input" data-key="varRef">${mb}</select></div>`;
    h+=pT('onLabel','Texte ON',w.onLabel||'ACTIF')+pT('offLabel','Texte OFF',w.offLabel||'inactif');
    h+=pC('color','Couleur actif',w.color||'#56d364')+pC('colorOff','Couleur inactif',w.colorOff||'#484f58');
  }
  if(w.type==='alarm_light'){
    h+=`<div class="prop-section">Variable</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Source</div><select class="prop-input" data-key="varRef"><option value="">— choisir —</option><optgroup label="Mémoires M">${mb}</optgroup>${gpIn?`<optgroup label="GPIO Entrées">${gpIn}</optgroup>`:''}<optgroup label="GPIO Sorties">${gp}</optgroup><optgroup label="Analogiques">${an}</optgroup><optgroup label="Registres RF">${rfOpts}</optgroup></select></div>`;
    h+=`<div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div><input class="prop-input" type="text" list="${_SYN_RF_DL}" data-key="varRef" value="${w.varRef||''}" placeholder="ex: RF0, M3, ANA0…" style="width:100%;box-sizing:border-box"></div>`;
    h+=`<div class="prop-row" style="font-size:10px;color:var(--t3);padding:2px 6px">Allumé si valeur ≠ 0</div>`;
    h+=pC('colorOn','Couleur alarme',w.colorOn||'#f85149')+pC('colorOff','Couleur normal',w.colorOff||'#484f58');
  }
  if(w.type==='label'){h+=`<div class="prop-section">Texte</div>`+pT('text','Contenu',w.text||'')+pN('fontSize','Taille px',w.fontSize||14)+pC('color','Couleur',w.color||'#e6edf3')+`<label class="chk-row"><input type="checkbox" data-key="bold" ${w.bold?'checked':''}> Gras</label>`+`<div class="prop-row"><div class="prop-label">Alignement</div><select class="prop-input" data-key="align"><option value="center" ${(w.align||'center')==='center'?'selected':''}>Centre</option><option value="left" ${w.align==='left'?'selected':''}>Gauche</option><option value="right" ${w.align==='right'?'selected':''}>Droite</option></select></div>`+`<div class="prop-section">Fond (optionnel)</div>`+pC('bg','Couleur fond',w.bg||'')+pC('gradientColor2','Couleur 2 (dégradé)',w.gradientColor2||'')+`<div class="prop-row"><div class="prop-label">Direction</div><select class="prop-input" data-key="gradientDir"><option value="horizontal" ${(w.gradientDir||'horizontal')==='horizontal'?'selected':''}>Horizontal ↔</option><option value="vertical" ${w.gradientDir==='vertical'?'selected':''}>Vertical ↕</option><option value="radial" ${w.gradientDir==='radial'?'selected':''}>Radial ○</option></select></div>`+pN('radius','Arrondi',w.radius||4)+pN('opacity','Opacité fond',w.opacity??1,'0','1',0.05);}
  // ── Texte dynamique ──────────────────────────────────────────────────────────
  if(w.type==='dyn_text'){
    h+=`<div class="prop-section">Source PLC</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Variable</div>${rfAnComboFor('varRef')}</div>`;
    h+=`<div class="prop-section">Format</div>`;
    h+=pT('prefix','Préfixe',w.prefix||'');
    h+=pT('suffix','Suffixe / unité',w.suffix||'');
    h+=pN('decimals','Décimales',w.decimals??1,'0','4',1);
    h+=pT('map','Mappage (0:Arrêt,1:Marche…)',w.map||'');
    h+=`<div class="prop-section">Style</div>`;
    h+=pN('fontSize','Taille px',w.fontSize||16);
    h+=pC('color','Couleur texte',w.color||'#e6edf3');
    h+=`<label class="chk-row"><input type="checkbox" data-key="bold" ${w.bold?'checked':''}> Gras</label>`;
    h+=`<div class="prop-row"><div class="prop-label">Alignement</div><select class="prop-input" data-key="align"><option value="left" ${(w.align||'left')==='left'?'selected':''}>Gauche</option><option value="center" ${w.align==='center'?'selected':''}>Centre</option><option value="right" ${w.align==='right'?'selected':''}>Droite</option></select></div>`;
    h+=`<div class="prop-section">Fond (optionnel)</div>`;
    h+=pC('bg','Couleur fond',w.bg||'');
    h+=pN('radius','Arrondi',w.radius||4);
    h+=pT('label','Étiquette',w.label||'');
  }
  if(w.type==='rect'){
    h+=pC('bg','Fond',w.bg||'#161b22')+pC('color','Bordure',w.color||'#30363d')+pN('radius','Arrondi',w.radius||8)+pN('opacity','Opacité',w.opacity??1,'0','1',0.05);
    h+=pC('gradientColor2','Couleur 2 (dégradé)',w.gradientColor2||'');
    h+=`<div class="prop-row"><div class="prop-label">Direction dégradé</div><select class="prop-input" data-key="gradientDir">
      <option value="vertical" ${(w.gradientDir||'vertical')==='vertical'?'selected':''}>Vertical ↕</option>
      <option value="horizontal" ${w.gradientDir==='horizontal'?'selected':''}>Horizontal ↔</option>
      <option value="radial" ${w.gradientDir==='radial'?'selected':''}>Radial ○</option>
    </select></div>`;
    h+=`<div class="prop-section">Relief 3D</div>`+pN('bevel','Biseau (0=plat)',w.bevel||0,'0','10',1);
  }
  if(w.type==='pipe'){h+=pC('color','Couleur',w.color||'#58a6ff')+pN('thickness','Épaisseur',w.thickness||8)+`<label class="chk-row"><input type="checkbox" data-key="horizontal" ${w.horizontal!==false?'checked':''}> Horizontal</label>`;}
  // ── Formes de dessin ──────────────────────────────────────────────────────
  if(['draw_circle','draw_ellipse','draw_triangle'].includes(w.type)){
    h+=`<div class="prop-section">Remplissage</div>`;
    h+=pC('fill','Couleur 1',w.fill||'#1a2f45');
    h+=pC('gradientColor2','Couleur 2 (dégradé)',w.gradientColor2||'');
    h+=`<div class="prop-row"><div class="prop-label">Direction</div><select class="prop-input" data-key="gradientDir">
      <option value="vertical" ${(w.gradientDir||'vertical')==='vertical'?'selected':''}>Vertical ↕</option>
      <option value="horizontal" ${w.gradientDir==='horizontal'?'selected':''}>Horizontal ↔</option>
      <option value="radial" ${w.gradientDir==='radial'?'selected':''}>Radial ○</option>
    </select></div>`;
    h+=`<div class="prop-section">Contour</div>`;
    h+=pC('stroke','Couleur contour',w.stroke||'#58a6ff');
    h+=pN('strokeWidth','Épaisseur px',w.strokeWidth||2,'0','20',1);
    h+=pN('opacity','Opacité',w.opacity??1,'0','1',0.05);
    h+=`<div class="prop-section">Relief 3D</div>`;
    h+=pN('bevel','Biseau (0=plat)',w.bevel||0,'0','10',1);
  }
  if(w.type==='draw_line'){
    h+=`<div class="prop-section">Ligne</div>`;
    h+=pC('stroke','Couleur',w.stroke||'#58a6ff');
    h+=pN('strokeWidth','Épaisseur px',w.strokeWidth||3,'1','30',1);
    h+=pN('lineDash','Tirets (0=plein)',w.lineDash||0,'0','30',1);
    h+=`<label class="chk-row"><input type="checkbox" data-key="arrowEnd" ${w.arrowEnd?'checked':''}> Flèche en bout</label>`;
    h+=pN('opacity','Opacité',w.opacity??1,'0','1',0.05);
  }
  if(w.type==='symbol'){
    // Construire le sélecteur de symbole par groupe
    const symOpts=Object.entries(SYM_GROUPS).map(([grp,syms])=>{
      const grpLabel={vannes:'Vannes',pompes:'Pompes/Moteurs',capteurs:'Capteurs',reservoirs:'Réservoirs',echangeurs:'Échangeurs',elec:'Électrique'}[grp]||grp;
      const opts=syms.map(s=>`<option value="${s.id}" ${w.symId===s.id?'selected':''}>${s.label}</option>`).join('');
      return`<optgroup label="${grpLabel}">${opts}</optgroup>`;
    }).join('');
    h+=`<div class="prop-section">Symbole P&amp;ID</div>`;
    h+=pT('label','Étiquette',w.label||'');
    h+=`<div class="prop-row"><div class="prop-label">Symbole</div><select class="prop-input" data-key="symId">${symOpts}</select></div>`;
    h+=pC('color','Couleur défaut',w.color||'#58a6ff')+pN('opacity','Opacité',w.opacity??1,'0','1',0.05);
    h+=`<div class="prop-section">Liaison PLC</div><div class="prop-row"><div class="prop-label">Variable (optionnel)</div><select class="prop-input" data-key="varRef"><option value="">— aucune —</option><optgroup label="Registres RF">${rfOpts}</optgroup><optgroup label="Bits M">${mb}</optgroup>${gpIn?`<optgroup label="GPIO Entrées">${gpIn}</optgroup>`:''}<optgroup label="GPIO Sorties">${gp}</optgroup></select></div><div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>${rf}</div>`;
    h+=pC('colorOn','Couleur actif',w.colorOn||'#3fb950')+pC('colorOff','Couleur inactif',w.colorOff||'#484f58');
  }
  if(w.type==='nav_page'){
    // Liste dynamique des pages disponibles
    const pageOpts=pages.map(p=>`<option value="${p.id}" ${(w.targetPage===p.id||w.targetPage===p.name)?'selected':''}>${p.name}${p.isPopup?' 🔲':''}</option>`).join('');
    h+=`<div class="prop-section">Navigation</div>`;
    const popupNote=pages[w.targetPage]?.isPopup?' 🔲 popup':'';
    h+=`<div class="prop-row"><div class="prop-label">Page cible</div><select class="prop-input" data-key="targetPage">${pageOpts}</select></div>`;
    h+=`<div style="color:var(--fbd-text2,var(--text2));font-size:9px;padding:2px 0 6px">
      ${pages[w.targetPage]?.isPopup?'<span style="color:var(--purple)">⊞ Ouvrira en popup</span>':'➜ Navigation directe'}
    </div>`;
    h+=pT('label','Texte',w.label||'Vue suivante');
    h+=pT('icon','Icône (emoji/texte)',w.icon||'→');
    h+=`<div class="prop-row"><div class="prop-label">Forme</div>
      <select class="prop-input" data-key="shape">
        <option value="rect" ${w.shape==='rect'||!w.shape?'selected':''}>Rectangle</option>
        <option value="pill" ${w.shape==='pill'?'selected':''}>Pilule arrondie</option>
        <option value="arrow" ${w.shape==='arrow'?'selected':''}>Flèche</option>
      </select></div>`;
    h+=pC('color','Couleur accent',w.color||'#2563eb');
    h+=pC('bg','Fond',w.bg||'#1a2f45');
    h+=pC('textColor','Couleur texte',w.textColor||'');
  } else if(w.type==='cntdisplay'){
    h+=`<div class="prop-section">Compteur de marche</div>`;
    h+=`<div class="prop-row"><div class="prop-label">ID bloc FBD</div>
      <input type="text" class="prop-input" data-key="blockId" value="${w.blockId||''}"
        placeholder="ex: B7" style="font-family:monospace;font-size:11px;"></div>`;
    h+=`<div style="color:#8b949e;font-size:9px;padding:2px 0 6px">
      ID du bloc RUNTIMCNT (visible dans ses propriétés FBD)</div>`;
    h+=`<label class="chk-row"><input type="checkbox" data-key="showStarts" ${w.showStarts!==false?'checked':''}> Nb démarrages</label>`;
    h+=`<label class="chk-row"><input type="checkbox" data-key="showTotal" ${w.showTotal!==false?'checked':''}> Heures totales</label>`;
    h+=`<label class="chk-row"><input type="checkbox" data-key="showRuntime" ${w.showRuntime!==false?'checked':''}> Durée session</label>`;
    h+=pC('color','Couleur',w.color||'#50ff50');
  } else if(w.type==='nav_back'){
    h+=`<div class="prop-section">Bouton Retour</div>`;
    h+=pT('label','Texte',w.label||'Retour');
    h+=pT('icon','Icône',w.icon||'←');
    h+=`<div class="prop-row"><div class="prop-label">Forme</div>
      <select class="prop-input" data-key="shape">
        <option value="rect" ${w.shape==='rect'||!w.shape?'selected':''}>Rectangle</option>
        <option value="pill" ${w.shape==='pill'?'selected':''}>Pilule</option>
        <option value="arrow" ${w.shape==='arrow'?'selected':''}>Flèche</option>
      </select></div>`;
    h+=pC('color','Couleur accent',w.color||'#475569');
    h+=pC('bg','Fond',w.bg||'#1e293b');
    h+=pC('textColor','Couleur texte',w.textColor||'');
  } else if(w.type==='image'){const iop=userImages.map(i=>`<option value="${i.id}" ${w.imageId===i.id?'selected':''}>${i.name}</option>`).join('');h+=`<div class="prop-section">Image</div><div class="prop-row"><div class="prop-label">Source</div><select class="prop-input" data-key="imageId">${iop||'<option>Aucune image</option>'}</select></div>`+pT('label','Étiquette',w.label||'')+`<div class="prop-row"><div class="prop-label">Ajustement</div><select class="prop-input" data-key="fit"><option value="contain" ${w.fit==='contain'?'selected':''}>Proportionnel</option><option value="stretch" ${w.fit==='stretch'?'selected':''}>Étiré</option></select></div>`+pN('opacity','Opacité',w.opacity??1,'0','1',0.05);}
  if(w.type==='animated'){
    const animOpts=Object.entries(ANIM_SYMBOLS).map(([id,def])=>`<option value="${id}" ${w.animId===id?'selected':''}>${def.label}</option>`).join('');
    const allVars=`<option value="">— aucune —</option><optgroup label="Registres RF">${rfOpts}</optgroup><optgroup label="Bits M">${mb}</optgroup>${gpIn?`<optgroup label="GPIO Entrées">${gpIn}</optgroup>`:''}<optgroup label="GPIO Sorties">${gp}</optgroup>`;
    h+=`<div class="prop-section">Symbole animé</div>`;
    h+=pT('label','Étiquette',w.label||'');
    h+=`<div class="prop-row"><div class="prop-label">Type</div><select class="prop-input" data-key="animId">${animOpts}</select></div>`;
    h+=`<div class="prop-section">Liaison PLC</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Variable ON/OFF</div><select class="prop-input" data-key="varRef">${allVars}</select></div>`;
    h+=`<div class="prop-row"><div class="prop-label" style="font-size:10px;color:var(--t3)">✏ Saisie libre</div>${rf}</div>`;
    h+=pC('colorOn','Couleur actif',w.colorOn||'#f0883e');
    h+=pC('colorOff','Couleur inactif',w.colorOff||'#484f58');
    h+=`<div style="margin-top:8px;padding:6px 8px;background:#0d2010;border-radius:5px;font-size:9px;color:#3fb950;line-height:1.6;">
      💡 Animation visible en mode <b>Opérateur</b><br>
      Lier à un bit M, GPIO ou registre RF pour activer/désactiver
    </div>`;
    // ── Champs extra Ballon ECS ──────────────────────────────────────
    if(w.animId==='ballon_ecs'){
      h+=`<div class="prop-section" style="color:#58a6ff">🌡 Ballon ECS — Sondes température</div>`;
      h+=`<div class="prop-row"><div class="prop-label">T° sonde haute</div>${rfAnComboFor('dvTempHaut')}</div>`;
      h+=`<div class="prop-row"><div class="prop-label">T° sonde basse</div>${rfAnComboFor('dvTempBas')}</div>`;
      h+=`<div class="prop-section" style="color:#ffd740">🎯 Consigne</div>`;
      h+=`<div class="prop-row"><div class="prop-label">Consigne (RF)</div>${rfComboFor('dvConsigne')}</div>`;
      h+=`<div class="prop-row"><div class="prop-label">Consigne fixe °C</div><input class="prop-input" type="number" data-key="consigneVal" min="20" max="90" step="1" value="${w.consigneVal||60}" placeholder="60"></div>`;
      h+=`<div class="prop-section" style="color:#a371f7">🎨 Couleurs du dégradé</div>`;
      h+=`<div class="prop-row"><div class="prop-label">Froid (bas)</div><input class="prop-input" type="color" data-key="colorCold" value="${w.colorCold||'#1a6aff'}" style="height:28px;padding:2px 4px;cursor:pointer"></div>`;
      h+=`<div class="prop-row"><div class="prop-label">Chaud (haut)</div><input class="prop-input" type="color" data-key="colorHot" value="${w.colorHot||'#f85149'}" style="height:28px;padding:2px 4px;cursor:pointer"></div>`;
      h+=`<div style="margin-top:4px;padding:5px 8px;background:#0d1117;border-radius:5px;font-size:9px;color:#8b949e;line-height:1.7;">
        Le dégradé interpole entre <b style="color:${w.colorCold||'#1a6aff'}">Froid</b> et <b style="color:${w.colorHot||'#f85149'}">Chaud</b><br>
        proportionnellement à la température vs consigne.<br>
        Les textes de sonde prennent la même couleur interpolée.
      </div>`;
    }
  } else if(w.type==='plancher_w'){
    h+=`<div class="prop-section" style="color:#ff7043">🔥 Plancher chauffant</div>`;
    h+=pT('label','Titre widget',w.label||'Plancher chauffant');
    h+=`<div class="prop-section">Variables PLC — Températures</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° ambiante</div>${rfAnComboFor('varRef')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">SP actif (RF)</div>${rfComboFor('varSP')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° départ (RF)</div>${rfComboFor('varDep')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° retour (RF)</div>${rfComboFor('varRet')}</div>`;
    h+=`<div class="prop-section">Variables DV — États</div>`;
    h+=pT('dvCirc','DV Circulateur',w.dvCirc||'');
    h+=pT('dvV3v','DV Vanne V3V',w.dvV3v||'');
    h+=pT('dvErr','DV Erreur',w.dvErr||'');

  } else if(w.type==='chaudiere_w'){
    h+=`<div class="prop-section" style="color:#ff5252">🔥 Chaudière</div>`;
    h+=pT('label','Titre widget',w.label||'Chaudière');
    h+=`<div class="prop-section">Variables PLC</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° retour (RF)</div>${rfComboFor('varRet')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° départ (RF)</div>${rfComboFor('varDep')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Consigne (RF)</div>${rfComboFor('varSP')}</div>`;
    h+=`<div class="prop-section">Variables DV</div>`;
    h+=pT('dvBrulee','DV Brûleur',w.dvBrulee||'');
    h+=pT('dvPompe','DV Pompe',w.dvPompe||'');
    h+=pT('dvAlm','DV Alarme',w.dvAlm||'');

  } else if(w.type==='solar_w'){
    h+=`<div class="prop-section" style="color:#ffd740">☀ Solaire thermique</div>`;
    h+=pT('label','Titre widget',w.label||'Solaire');
    h+=`<div class="prop-section">Températures</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° capteur (RF)</div>${rfAnComboFor('varCapt')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Ballon ECS (RF)</div>${rfAnComboFor('varEcs')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Ballon chauf (RF)</div>${rfAnComboFor('varChauf')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">ΔT (RF diagnostic)</div>${rfComboFor('varDelta')}</div>`;
    h+=`<div class="prop-section">Variables DV</div>`;
    h+=pT('dvPompe','DV Pompe',w.dvPompe||'');
    h+=pT('dvVanneEcs','DV Vanne ECS',w.dvVanneEcs||'');
    h+=pT('dvVanneCh','DV Vanne Chauf',w.dvVanneCh||'');
    h+=pT('dvAlm','DV Alarme',w.dvAlm||'');

  } else if(w.type==='zone_chauf_w'){
    h+=`<div class="prop-section" style="color:#69f0ae">🏠 Zone chauffage</div>`;
    h+=pT('label','Titre widget',w.label||'Zone chauffage');
    h+=`<div class="prop-section">Variables PLC</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° ambiante</div>${rfAnComboFor('varRef')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Consigne (RF)</div>${rfComboFor('varSP')}</div>`;
    h+=`<div class="prop-section">Variables DV</div>`;
    h+=pT('dvVanne','DV Vanne',w.dvVanne||'');
    h+=pT('dvActive','DV Zone active',w.dvActive||'');

  } else if(w.type==='ecs_w'){
    h+=`<div class="prop-section" style="color:#40c4ff">💧 ECS</div>`;
    h+=pT('label','Titre widget',w.label||'ECS');
    h+=`<div class="prop-section">Températures</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° ECS</div>${rfAnComboFor('varEcs')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">T° primaire</div>${rfAnComboFor('varPrim')}</div>`;
    h+=`<div class="prop-row"><div class="prop-label">Consigne (RF)</div>${rfComboFor('varSP')}</div>`;
    h+=`<div class="prop-section">Variables DV</div>`;
    h+=pT('dvPompe','DV Pompe',w.dvPompe||'');
    h+=pT('dvAlm','DV Anti-légionellose',w.dvAlm||'');

  } else if(w.type==='prog_h_w'){
    h+=`<div class="prop-section" style="color:#ffb300">📅 Planning Jour/Nuit</div>`;
    h+=pT('label','Titre widget',w.label||'Planning Jour/Nuit');
    h+=`<div class="prop-section">Variables PLC</div>`;
    h+=`<div class="prop-row"><div class="prop-label">SP actif (RF)</div>${rfComboFor('varSP')}</div>`;
    h+=pT('dvJour','DV JOUR (booléen)',w.dvJour||'');
    h+=pT('dvVac','DV VACANCES (booléen)',w.dvVac||'');
    h+=`<div class="prop-section">📅 Horaires hebdomadaires</div>`;
    const _jFr=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    const _hDts=w.hDebuts||[6.5,6.5,6.5,6.5,6.5,8,8];
    const _hFs=w.hFins||[22,22,22,22,22,22,22];
    const _days=w.days!==undefined?w.days:[true,true,true,true,true,false,false];
    const _hOpt=(val)=>[...Array(24*4)].map((_,i)=>{const h2=Math.floor(i/4),m=i%4*15;const v=h2+m/60;return `<option value="${v}" ${Math.abs((val??6.5)-v)<0.01?'selected':''}>${String(h2).padStart(2,'0')}:${String(m).padStart(2,'0')}</option>`;}).join('');
    _jFr.forEach((jn,idx)=>{
      const act=_days[idx]!==false;
      h+=`<div style="margin:3px 0;padding:5px 6px;background:${act?'#1a1200':'#0d1117'};border:1px solid ${act?'#ffb30050':'#30363d'};border-radius:5px;">`;
      h+=`<div style="display:flex;align-items:center;gap:6px;margin-bottom:${act?'4px':'0'}">`;
      h+=`<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;font-weight:bold;color:${act?'#ffb300':'#484f58'}"><input type="checkbox" data-dayidx="${idx}" class="prog-day-chk" ${act?'checked':''} style="cursor:pointer"> ${jn}</label>`;
      h+=`</div>`;
      if(act){
        h+=`<div class="prog-day-times-${idx}" style="display:flex;gap:4px;align-items:center;font-size:10px">`;
        h+=`<span style="color:#8b949e;width:28px">Deb</span><select class="prop-input prog-hd" data-dayidx="${idx}" style="flex:1;font-size:10px">${_hOpt(_hDts[idx])}</select>`;
        h+=`<span style="color:#8b949e;width:24px">Fin</span><select class="prop-input prog-hf" data-dayidx="${idx}" style="flex:1;font-size:10px">${_hOpt(_hFs[idx])}</select>`;
        h+=`</div>`;
      }else{
        h+=`<div class="prog-day-times-${idx}" style="display:none;gap:4px;align-items:center;font-size:10px">`;
        h+=`<span style="color:#8b949e;width:28px">Deb</span><select class="prop-input prog-hd" data-dayidx="${idx}" style="flex:1;font-size:10px">${_hOpt(_hDts[idx])}</select>`;
        h+=`<span style="color:#8b949e;width:24px">Fin</span><select class="prop-input prog-hf" data-dayidx="${idx}" style="flex:1;font-size:10px">${_hOpt(_hFs[idx])}</select>`;
        h+=`</div>`;
      }
      h+=`</div>`;
    });
    h+=`<div style="color:#ffb300;font-size:9px;padding:3px 0 4px;line-height:1.5">
      Lier le registre SP actif au bloc FBD PROG_H (reg_sp).<br>
      Les horaires ci-dessus sont affichés dans le widget.</div>`;

  }
  h+=`<button class="delete-btn" onclick="delSel()">✕ Supprimer</button>`;
  body.innerHTML=h;
  body.querySelectorAll('[data-key]').forEach(el=>{
    const ap=()=>{
      const k=el.dataset.key;
      let v;
      if(el.type==='checkbox')      v=el.checked;
      else if(el.type==='number')   v=parseFloat(el.value)||0;
      else if(el.value==='true')    v=true;   // convertir string "true"→boolean
      else if(el.value==='false')   v=false;  // convertir string "false"→boolean
      else                          v=el.value;
      w[k]=v;
      // Invalider le cache SVG si le symbole ou sa couleur change
      if(w.type==='symbol'&&(k==='symId'||k==='color'||k==='colorOn'||k==='colorOff')){
        Object.keys(_svgCache).forEach(key=>{if(key.startsWith(w.symId+'|'))delete _svgCache[key];});
      }
      renderAll();_dirty=true;
      // Pour les clés qui modifient la structure conditionnelle du panneau,
      // rafraîchir showProps après le cycle courant (évite le freeze Qt WebEngine).
      const _structKeys=['action','animId','symId','shape','btnStyle'];
      if(_structKeys.includes(k)){
        setTimeout(()=>{ if(selected===w) showProps(w); },0);
      }
    };
    // Sur les <select>, n'écouter que 'change' (pas 'input') pour éviter
    // le double déclenchement qui peut geler le dropdown dans Qt WebEngine.
    if(el.tagName==='SELECT'){
      el.addEventListener('change',ap);
    } else {
      el.addEventListener('change',ap);
      el.addEventListener('input',ap);
    }
  });
  // ── Listeners spécifiques prog_h_w : cases à cocher jours + sélecteurs horaires ──
  if(w.type==='prog_h_w'){
    body.querySelectorAll('.prog-day-chk').forEach(chk=>{
      chk.addEventListener('change',()=>{
        const idx=parseInt(chk.dataset.dayidx);
        if(!w.days)w.days=[true,true,true,true,true,false,false];
        w.days[idx]=chk.checked;
        const timesDiv=body.querySelector(`.prog-day-times-${idx}`);
        if(timesDiv){timesDiv.style.display=chk.checked?'flex':'none';}
        renderAll();_dirty=true;
      });
    });
    body.querySelectorAll('.prog-hd').forEach(sel=>{
      sel.addEventListener('change',()=>{
        const idx=parseInt(sel.dataset.dayidx);
        if(!w.hDebuts)w.hDebuts=[6.5,6.5,6.5,6.5,6.5,8,8];
        w.hDebuts[idx]=parseFloat(sel.value);
        w.hDebut=w.hDebuts[0];
        renderAll();_dirty=true;
      });
    });
    body.querySelectorAll('.prog-hf').forEach(sel=>{
      sel.addEventListener('change',()=>{
        const idx=parseInt(sel.dataset.dayidx);
        if(!w.hFins)w.hFins=[22,22,22,22,22,22,22];
        w.hFins[idx]=parseFloat(sel.value);
        w.hFin=w.hFins[0];
        renderAll();_dirty=true;
      });
    });
  }
}
function pT(k,l,v){return`<div class="prop-row"><div class="prop-label">${l}</div><input type="text" class="prop-input" data-key="${k}" value="${String(v).replace(/"/g,'&quot;')}"></div>`;}
function pN(k,l,v,mn='',mx='',st=1){return`<div class="prop-row"><div class="prop-label">${l}</div><input type="number" class="prop-input" data-key="${k}" value="${v}" min="${mn}" max="${mx}" step="${st}"></div>`;}
function pC(k,l,v){return`<div class="prop-row"><div class="prop-label">${l}</div><input type="color" class="prop-input prop-color" data-key="${k}" value="${v}"></div>`;}
function delSel(){if(!selected)return;widgets=widgets.filter(w=>w!==selected);selected=null;showProps(null);renderAll();_dirty=true;}

// ═══════════════ TOAST ═══════════════
let _tt=null;
function toast(m,t='ok'){const e=document.getElementById('toast');e.textContent=m;e.className=`show ${t}`;clearTimeout(_tt);_tt=setTimeout(()=>e.className='',2800);}

// ═══════════════ THÈME ═══════════════
function setSynopticTheme(name){
  if(name==='light'){
    document.documentElement.classList.add('theme-light');
  } else {
    document.documentElement.classList.remove('theme-light');
  }
  // Vider le cache des couleurs CSS et forcer le re-rendu
  const c=_cv; if(c&&c.__cache__){ for(const k in c.__cache__) delete c.__cache__[k]; }
  renderAll();
}
// Exposer globalement pour appel depuis PyQt runJavaScript
window.setSynopticTheme = setSynopticTheme;

// Basculement mode Opérateur / Édition depuis Python
window.setOperatorMode = function(enabled) {
  // enabled=true  → mode Opérateur → editMode=false
  // enabled=false → mode Édition   → editMode=true
  // On applique TOUJOURS l'état demandé (idempotent), sans présumer que le
  // DOM est déjà synchronisé avec la valeur courante de editMode : c'est
  // cette présomption qui causait l'ancien bug (sidebar visible au premier
  // chargement malgré editMode déjà à false).
  editMode = !enabled;
  applyMode();
};

// ── setGpioConfig — appelé par le studio quand la config GPIO change ───────────
window.setGpioConfig = function(gpioConfig){
  // gpioConfig = {"17":{"name":"Pompe ECS","mode":"output"}, ...}
  _SYNOPTIC_GPIO_OUT   = [];
  _SYNOPTIC_GPIO_IN    = [];
  _SYNOPTIC_GPIO_NAMES = {};
  Object.entries(gpioConfig).forEach(([pin, cfg])=>{
    const p = parseInt(pin);
    _SYNOPTIC_GPIO_NAMES[p] = cfg.name || ('GPIO'+p);
    if(cfg.mode === 'output') _SYNOPTIC_GPIO_OUT.push(p);
    if(cfg.mode === 'input')  _SYNOPTIC_GPIO_IN.push(p);
  });
  // Trier sorties par numéro Kx dans le nom (K1, K2, K3...) sinon par pin
  _SYNOPTIC_GPIO_OUT.sort((a,b)=>{
    const na=_SYNOPTIC_GPIO_NAMES[a]||'', nb=_SYNOPTIC_GPIO_NAMES[b]||'';
    const ma=na.match(/K(\d+)/i), mb=nb.match(/K(\d+)/i);
    if(ma&&mb) return parseInt(ma[1])-parseInt(mb[1]);
    if(ma) return -1; if(mb) return 1;
    return a-b;
  });
  // Trier entrées par numéro de pin
  _SYNOPTIC_GPIO_IN.sort((a,b)=>a-b);
  // Rafraîchir le panneau de propriétés si un widget est sélectionné
  if(selected) showProps(selected);
};

// ── setAnalogConfig — appelé par le studio quand la config sondes change ──────
window.setAnalogConfig = function(analogConfig){
  // analogConfig = {ads:[{address:"0x48", channels:[{id:"ANA0",name:"Sonde 5"},…]},…], …}
  _SYNOPTIC_ANA_NAMES = {};
  (analogConfig.ads || []).forEach(ads => {
    (ads.channels || []).forEach(ch => {
      if(ch.id && ch.name) _SYNOPTIC_ANA_NAMES[ch.id] = ch.name;
    });
  });
  // Rafraîchir le panneau de propriétés si un widget est sélectionné
  if(selected) showProps(selected);
};

// ═══════════════ INIT ═══════════════
// 1. Resize immédiat (synchrone, léger)
document.getElementById('gridBtn').classList.add('active');
renderPagesBar();
// Afficher la nav bar d'emblée (mode opérateur par défaut)
const _initNav=document.getElementById('nav-fixed-bar');
const _initNbt=document.getElementById('nav-bar-toggle');
if(_initNav){_initNav.classList.add('visible');}
if(_initNbt){_initNbt.className='tbtn on';}
renderNavFixed();
_resize();

// 2. Construction des grilles de symboles en différé
//    pour ne pas bloquer le thread JS au chargement
setTimeout(_buildSymGrids, 0);

// 3. canvas_ready est signalé par Python via loadFinished,
//    pas depuis JS (évite la course avec QWebChannel)


// ══════════════════════════════════════════════════════
// PANNEAU DE SIMULATION — saisie directe des valeurs
// ══════════════════════════════════════════════════════
function openSimPanel(){
  _buildSimPanel(_simCurrentTab);
  document.getElementById('sim-panel-overlay').style.display='flex';
}
function closeSimPanel(){
  document.getElementById('sim-panel-overlay').style.display='none';
  setTimeout(()=>document.body.focus(),0);
}
function switchSimTab(t){
  _simCurrentTab=t;
  ['sondes','registres','bits'].forEach(id=>{
    const b=document.getElementById('simtab-'+id);
    if(!b)return;
    const on=(id===t);
    b.style.background=on?'#1a2f45':'#161b22';
    b.style.color=on?'#58a6ff':'#8b949e';
    b.style.borderColor=on?'#58a6ff':'#30363d';
  });
  _buildSimPanel(t);
}
function _simTempColor(c){
  if(c==null)return'#484f58';
  const t=parseFloat(c);
  return t<10?'#58a6ff':t<30?'#3fb950':t<55?'#d29922':t<80?'#f0883e':'#f85149';
}
function _buildSimPanel(tab){
  const body=document.getElementById('sim-panel-body');
  if(!body)return;
  const s=plcState||{};
  if(tab==='sondes'){
    const keys=Object.keys(s.analog||{}).sort();
    if(!keys.length){
      body.innerHTML='<div style="color:#484f58;padding:30px;text-align:center;">Démarrez la simulation ▶ pour voir les sondes.</div>';
      return;
    }
    let h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;">';
    keys.forEach(ref=>{
      const info=s.analog[ref];
      const c=info.celsius!=null?parseFloat(info.celsius):20;
      const col=_simTempColor(c);
      h+=`<div style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <b style="color:#e6edf3;font-size:11px;">${ref}</b>
          <span style="color:#8b949e;font-size:10px;">${info.name||ref}</span>
        </div>
        <div style="font-size:24px;font-weight:700;color:${col};text-align:center;font-family:monospace;margin-bottom:8px;">${c.toFixed(1)} °C</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
          <span style="font-size:9px;color:#484f58;">-30°</span>
          <input type="range" min="-30" max="120" step="0.5" value="${c.toFixed(1)}"
            id="sims_${ref}" oninput="_simSetC('${ref}',parseFloat(this.value))"
            style="flex:1;accent-color:${col};cursor:pointer;">
          <span style="font-size:9px;color:#484f58;">120°</span>
        </div>
        <div style="display:flex;gap:6px;">
          <input type="number" step="0.5" min="-30" max="120" value="${c.toFixed(1)}"
            id="simi_${ref}"
            style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:5px;color:${col};font:bold 12px monospace;padding:3px 7px;text-align:right;outline:none;"
            onkeydown="if(event.key==='Enter'){_simSetC('${ref}',parseFloat(this.value));this.blur();document.body.focus();}">
          <button onclick="_simSetC('${ref}',parseFloat(document.getElementById('simi_${ref}').value))"
            style="background:#1a2f45;border:1px solid #58a6ff;border-radius:5px;color:#58a6ff;font-size:11px;padding:3px 8px;cursor:pointer;white-space:nowrap;">↵ Appliquer</button>
        </div>
      </div>`;
    });
    body.innerHTML=h+'</div>';
  } else if(tab==='registres'){
    const rfDesc={RF0:'Csg départ (calculé)',RF1:'Csg départ solaire (calculé)',RF2:'Csg V3V plancher (calculé)',RF3:'Index loi eau 0/1/3',RF4:'Consigne ambiance',RF5:'Consigne ECS',RF6:'Ballon MIN',RF7:'Ballon MAX/réhausse',RF8:'Sécu pannx MIN',RF9:'Sécu pannx MAX',RF12:'Csg départ loi eau',RF13:'HOUR',RF14:'MDAY',RF15:'WDAY'};
    const readOnly=['RF0','RF1','RF2','RF3','RF13','RF14','RF15'];
    const keys=Object.keys(s.registers||{}).filter(k=>k.startsWith('RF')).sort((a,b)=>parseInt(a.slice(2))-parseInt(b.slice(2)));
    if(!keys.length){body.innerHTML='<div style="color:#484f58;padding:30px;text-align:center;">Démarrez la simulation ▶ pour voir les registres.</div>';return;}
    let h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;">';
    keys.forEach(ref=>{
      const v=parseFloat(s.registers[ref]||0);
      const ro=readOnly.includes(ref);
      const col=ro?'#484f58':'#d29922';
      h+=`<div style="background:#161b22;border:1px solid ${ro?'#21262d':'#30363d'};border-radius:8px;padding:10px;${ro?'opacity:0.65':''}">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <b style="color:${col};font-size:11px;">${ref}</b>
          <span style="font-size:9px;color:#484f58;">${ro?'🔒 calculé':'✏ modifiable'}</span>
        </div>
        <div style="font-size:9px;color:#8b949e;margin-bottom:6px;">${rfDesc[ref]||ref}</div>
        <div style="display:flex;gap:5px;">
          <input type="number" step="0.5" value="${v.toFixed(1)}" id="simr_${ref}" ${ro?'disabled':''}
            style="flex:1;background:#0d1117;border:1px solid ${col}55;border-radius:5px;color:${col};font:bold 12px monospace;padding:3px 6px;text-align:right;outline:none;${ro?'cursor:not-allowed;':''}"
            onkeydown="if(event.key==='Enter'&&!this.disabled){_simSetRF('${ref}',parseFloat(this.value));this.blur();document.body.focus();}">
          ${ro?'':'<button onclick="_simSetRF(\''+ref+'\',parseFloat(document.getElementById(\'simr_'+ref+'\').value))" style="background:#1a1200;border:1px solid #d29922;border-radius:5px;color:#d29922;font-size:10px;padding:2px 6px;cursor:pointer;">↵</button>'}
        </div>
      </div>`;
    });
    body.innerHTML=h+'</div>';
  } else {
    const mDesc={M0:'Autori. chaudière K1',M1:'Demande plancher',M2:'ECS chaud.',M3:'ECS solaire',M4:'V3V sol→sol',M5:'Surchauffe plancher',M6:'Prog J/N',M7:'Réhausse K4',M8:'Marche BP',M9:'Arrêt chauffage',M10:'Forçage ECS',M11:'Reset/forçage',M12:'Forçage solaire',M13:'Inc. V3V',M14:'Déc. V3V'};
    const mKeys=Object.keys(s.memory||{}).filter(k=>k.startsWith('M')).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
    let h='<div style="font-size:10px;color:#8b949e;margin-bottom:8px;">Cliquer pour basculer</div>';
    h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;">';
    mKeys.forEach(ref=>{
      const v=!!s.memory[ref];
      h+=`<div onclick="_simTogM('${ref}')" id="simm_${ref}" style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
        <div id="simmd_${ref}" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;transition:all .2s;background:${v?'#3fb950':'#1a2a1a'};border:2px solid ${v?'#3fb950':'#30363d'};"></div>
        <div>
          <div id="simml_${ref}" style="font-weight:700;font-size:10px;color:${v?'#3fb950':'#8b949e'};">${ref} — ${v?'1 ON':'0 OFF'}</div>
          <div style="font-size:9px;color:#484f58;">${mDesc[ref]||''}</div>
        </div>
      </div>`;
    });
    h+='</div>';
    const gInputs=Object.entries(s.gpio||{}).filter(([,c])=>c.mode==='input');
    if(gInputs.length){
      h+='<div style="margin-top:12px;font-size:10px;color:#8b949e;margin-bottom:6px;">📥 Entrées GPIO</div>';
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px;">';
      gInputs.forEach(([pin,cfg])=>{
        const v=!!cfg.value;
        h+=`<div onclick="_simTogG('${pin}')" id="simg_${pin}" style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 10px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">
          <div id="simgd_${pin}" style="width:18px;height:18px;border-radius:50%;flex-shrink:0;transition:all .2s;background:${v?'#58a6ff':'#1a2535'};border:2px solid ${v?'#58a6ff':'#30363d'};"></div>
          <div><div style="font-weight:700;font-size:10px;color:${v?'#58a6ff':'#8b949e'};">GPIO${pin} — ${v?'1':'0'}</div><div style="font-size:9px;color:#484f58;">${cfg.name||''}</div></div>
        </div>`;
      });
      h+='</div>';
    }
    body.innerHTML=h;
  }
}
function _simSetC(ref,c){
  if(isNaN(c))return;
  const sl=document.getElementById('sims_'+ref);
  const inp=document.getElementById('simi_'+ref);
  if(sl&&document.activeElement!==sl)sl.value=c.toFixed(1);
  if(inp&&document.activeElement!==inp)inp.value=c.toFixed(1);
  // Envoyer au moteur
  if(window.pybridge&&window.pybridge.set_analog_celsius)
    window.pybridge.set_analog_celsius(ref,c);
  else
    fetch('/api/analog/sim',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ref:ref,celsius:c})}).catch(()=>{});
  // Mise à jour locale pour feedback immédiat
  if(plcState&&plcState.analog&&plcState.analog[ref]){
    plcState.analog[ref].celsius=c;
    if(!editMode)renderAll();
  }
}
function _simSetRF(ref,v){
  if(isNaN(v))return;
  cb('register_write',ref,v);
  if(plcState&&plcState.registers)plcState.registers[ref]=v;
}
function _simTogM(ref){
  const cur=!!(plcState?.memory?.[ref]);
  const nv=!cur;
  cb('memory_write',ref,nv?1.0:0.0);
  if(plcState&&plcState.memory)plcState.memory[ref]=nv;
  const dot=document.getElementById('simmd_'+ref);
  const lbl=document.getElementById('simml_'+ref);
  if(dot){dot.style.background=nv?'#3fb950':'#1a2a1a';dot.style.borderColor=nv?'#3fb950':'#30363d';}
  if(lbl){lbl.style.color=nv?'#3fb950':'#8b949e';lbl.textContent=ref+' — '+(nv?'1 ON':'0 OFF');}
  if(!editMode)renderAll();
}
function _simTogG(pin){
  const cfg=plcState?.gpio?.[pin];
  if(!cfg)return;
  const nv=!cfg.value;
  if(window.pybridge&&window.pybridge.gpio_write)
    window.pybridge.gpio_write(String(pin),nv?1.0:0.0);
  if(plcState&&plcState.gpio&&plcState.gpio[pin])plcState.gpio[pin].value=nv;
  const dot=document.getElementById('simgd_'+pin);
  if(dot){dot.style.background=nv?'#58a6ff':'#1a2535';dot.style.borderColor=nv?'#58a6ff':'#30363d';}
}
function _simRefreshValues(s){
  try{
    const ov=document.getElementById('sim-panel-overlay');
    if(!ov||ov.style.display==='none')return;
    if(_simCurrentTab==='sondes'&&s.analog){
      Object.entries(s.analog).forEach(([ref,info])=>{
        const c=info.celsius!=null?parseFloat(info.celsius):null;
        if(c===null)return;
        const sl=document.getElementById('sims_'+ref);
        if(sl&&document.activeElement!==sl)sl.value=c.toFixed(1);
      });
    }
    if(_simCurrentTab==='registres'&&s.registers){
      Object.entries(s.registers).forEach(([ref,v])=>{
        const inp=document.getElementById('simr_'+ref);
        if(inp&&inp.disabled&&document.activeElement!==inp)
          inp.value=parseFloat(v).toFixed(1);
      });
    }
    if(_simCurrentTab==='bits'&&s.memory){
      Object.entries(s.memory).forEach(([ref,v])=>{
        const bv=!!v;
        const dot=document.getElementById('simmd_'+ref);
        const lbl=document.getElementById('simml_'+ref);
        if(dot){dot.style.background=bv?'#3fb950':'#1a2a1a';dot.style.borderColor=bv?'#3fb950':'#30363d';}
        if(lbl){lbl.style.color=bv?'#3fb950':'#8b949e';lbl.textContent=ref+' — '+(bv?'1 ON':'0 OFF');}
      });
    }
  }catch(e){}
}
document.getElementById('sim-panel-overlay')?.addEventListener('click',e=>{
  if(e.target.id==='sim-panel-overlay')closeSimPanel();
});


// ══════════════════════════════════════════════════════════════
// EXPORT PNG du synoptique
// ══════════════════════════════════════════════════════════════
function _exportSynopticPNG(){
  try{
    // Créer un canvas temporaire avec fond opaque
    const tmp = document.createElement('canvas');
    tmp.width  = cvs.width;
    tmp.height = cvs.height;
    const tctx = tmp.getContext('2d');

    // Fond couleur de la page
    const bgCol = pg().background || '#0d1117';
    tctx.fillStyle = bgCol;
    tctx.fillRect(0, 0, tmp.width, tmp.height);

    // Image de fond (si présente)
    const _bgiExportRef = pg().bgImage;
    const _bgiExportEntry = _bgiExportRef ? userImages.find(i=>i.id===_bgiExportRef) : null;
    const _bgiExport = _bgiExportEntry ? _bgiExportEntry.dataUrl : _bgiExportRef;
    if(_bgiExport && _bgImageCache[_bgiExport] && _bgImageCache[_bgiExport].complete){
      const _img = _bgImageCache[_bgiExport];
      tctx.save();
      tctx.globalAlpha = pg().bgImageOpacity??0.8;
      const fit=pg().bgImageFit||'cover';
      const iw=_img.naturalWidth,ih=_img.naturalHeight,cw=tmp.width,ch=tmp.height;
      let dx=0,dy=0,dw=cw,dh=ch;
      if(fit==='contain'){const sc=Math.min(cw/iw,ch/ih);dw=iw*sc;dh=ih*sc;dx=(cw-dw)/2;dy=(ch-dh)/2;}
      else if(fit==='cover'){const sc=Math.max(cw/iw,ch/ih);dw=iw*sc;dh=ih*sc;dx=(cw-dw)/2;dy=(ch-dh)/2;}
      tctx.drawImage(_img,dx,dy,dw,dh);
      tctx.globalAlpha=1;
      tctx.restore();
    }

    // Copier le canvas principal
    tctx.drawImage(cvs, 0, 0);

    // Télécharger
    const link = document.createElement('a');
    const pageName = (pg().name || 'synoptique').replace(/[^a-zA-Z0-9_-]/g, '_');
    const date = new Date().toISOString().slice(0,10);
    link.download = `synoptique_${pageName}_${date}.png`;
    link.href = tmp.toDataURL('image/png');
    link.click();

    // Toast confirmation
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);' +
      'background:#1a1200;border:1px solid #d29922;border-radius:6px;' +
      'padding:8px 20px;color:#d29922;font-size:12px;z-index:9999;pointer-events:none;';
    t.textContent = `📷 ${link.download} exporté`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  } catch(e) {
    alert('Export échoué : ' + e);
  }
}



// ════════════════════════════════════════════════════════════════════
// ── WIDGETS BLOCS MÉTIER ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

// ── Helpers communs aux widgets métier ──────────────────────────────
function _mHdr(w, title, icon, accent){
  ctx.fillStyle = accent+'18';
  rr(ctx,w.x,w.y,w.w,22,{tl:8,tr:8,bl:0,br:0});
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(icon+' '+title, w.x+8, w.y+11);
}
function _mRow(x,y,w,label,val,unit,color,ry,rh){
  ctx.fillStyle = _bg4()+'80';
  ctx.fillRect(x+4,ry,w-8,rh-1);
  ctx.fillStyle = _t2(); ctx.font='9px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(label, x+8, ry+rh/2);
  ctx.fillStyle = color||'#e6edf3'; ctx.font='bold 12px monospace'; ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillText(val+(unit?' '+unit:''), x+w-8, ry+rh/2);
}
function _mState(cx,y,label,active,colorOn,colorOff){
  const c = active ? colorOn : (colorOff||'#484f58');
  ctx.fillStyle = c+'22'; rr(ctx,cx-28,y,56,16,4); ctx.fill();
  ctx.strokeStyle=c; ctx.lineWidth=1; rr(ctx,cx-28,y,56,16,4); ctx.stroke();
  ctx.fillStyle=c; ctx.font='bold 8px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label, cx, y+8);
}
function _mBadge(cx,y,text,color){
  const tw=ctx.measureText(text).width+12;
  ctx.fillStyle=color+'25'; rr(ctx,cx-tw/2,y-8,tw,16,4); ctx.fill();
  ctx.strokeStyle=color+'60'; ctx.lineWidth=1; rr(ctx,cx-tw/2,y-8,tw,16,4); ctx.stroke();
  ctx.fillStyle=color; ctx.font='bold 9px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text,cx,y);
}

// ─────────────────────────────────────────────────────────────────────
// PLANCHER — Widget tableau de bord plancher chauffant
// varRef=T_AMB, varSP=RF registre consigne, varDep=RF départ, varRet=RF retour
// dvCirc=DV circulateur, dvV3v=DV vanne, dvErr=DV erreur
// ─────────────────────────────────────────────────────────────────────
function rPlancher(w){
  const accent='#ff7043';
  const t_amb = getV(w.varRef);          // température ambiante
  const t_dep = getV(w.varDep||'');      // départ
  const t_ret = getV(w.varRet||'');      // retour
  const sp    = getV(w.varSP||'');       // consigne active
  const circ  = getV(w.dvCirc||'');      // circulateur ON/OFF
  const v3v   = getV(w.dvV3v||'');       // vanne ouverte
  const err   = getV(w.dvErr||'');       // erreur

  // Fond
  ctx.fillStyle = _bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle = err ? '#f85149' : accent+'60'; ctx.lineWidth = err?2:1;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();

  // Header
  _mHdr(w, w.label||'Plancher chauffant', '🔥', accent);

  // Rows
  const rowH = 18;
  const rows = [
    {l:'T° ambiante', v: t_amb!=null?t_amb.toFixed(1):'—', u:'°C', c: accent},
    {l:'Consigne',    v: sp!=null?sp.toFixed(1):'—',        u:'°C', c:'#ffb300'},
    {l:'T° départ',  v: t_dep!=null?t_dep.toFixed(1):'—',  u:'°C', c:'#ff6040'},
    {l:'T° retour',  v: t_ret!=null?t_ret.toFixed(1):'—',  u:'°C', c:'#40a0ff'},
  ];
  rows.forEach((r,i) => _mRow(w.x,w.y,w.w, r.l,r.v,r.u,r.c, w.y+26+i*rowH, rowH));

  // Barre delta départ-retour
  if(t_dep!=null&&t_ret!=null){
    const delta=t_dep-t_ret, dmax=15;
    const bx=w.x+8, by=w.y+26+rows.length*rowH+2, bw=w.w-16, bh=6;
    ctx.fillStyle=_bg4(); rr(ctx,bx,by,bw,bh,3); ctx.fill();
    const p=Math.min(1,Math.max(0,delta/dmax));
    ctx.fillStyle=p>0.2?'#ff6040':'#484f58'; rr(ctx,bx,by,bw*p,bh,3); ctx.fill();
    ctx.fillStyle=_t2(); ctx.font='8px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(`ΔT ${delta>=0?'+':''}${delta.toFixed(1)}°C`, bx, by+8);
  }

  // États
  const sy = w.y+w.h-22;
  _mState(w.x+w.w*0.25, sy, circ?'CIRC ●':'CIRC ○', !!circ, '#3fb950','#484f58');
  _mState(w.x+w.w*0.55, sy, v3v?'V3V ●':'V3V ○',   !!v3v,  '#ffb300','#484f58');
  _mState(w.x+w.w*0.82, sy, err?'ERR ⚠':'OK ✓',    !!err,  '#f85149','#3fb950');

  _drawEditOverlay(w);
}

// ─────────────────────────────────────────────────────────────────────
// CHAUDIERE — Widget tableau de bord chaudière
// ─────────────────────────────────────────────────────────────────────
function rChaudiere(w){
  const accent='#ff5252';
  const t_ret  = getV(w.varRet||'');
  const t_dep  = getV(w.varDep||'');
  const sp     = getV(w.varSP||'');
  const brulee = getV(w.dvBrulee||'');
  const pompe  = getV(w.dvPompe||'');
  const alm    = getV(w.dvAlm||'');

  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle=alm?'#f85149':accent+'60'; ctx.lineWidth=alm?2:1;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();
  _mHdr(w, w.label||'Chaudière', '🔥', accent);

  const rowH=18;
  const rows=[
    {l:'T° retour', v:t_ret!=null?t_ret.toFixed(1):'—', u:'°C', c:'#40a0ff'},
    {l:'T° départ', v:t_dep!=null?t_dep.toFixed(1):'—', u:'°C', c:'#ff6040'},
    {l:'Consigne',  v:sp!=null?sp.toFixed(1):'—',        u:'°C', c:'#ffb300'},
  ];
  rows.forEach((r,i)=>_mRow(w.x,w.y,w.w,r.l,r.v,r.u,r.c,w.y+26+i*rowH,rowH));

  // Représentation flamme
  const flamOn=!!brulee;
  const fx=w.x+w.w/2, fy=w.y+26+rows.length*rowH+14;
  ctx.font='28px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.globalAlpha=flamOn?1:0.2; ctx.fillText('🔥',fx,fy); ctx.globalAlpha=1;
  ctx.fillStyle=flamOn?'#ff5252':'#484f58'; ctx.font='8px sans-serif'; ctx.textBaseline='top';
  ctx.fillText(flamOn?'BRÛLEUR ON':'BRÛLEUR OFF', fx, fy+16);

  const sy=w.y+w.h-22;
  _mState(w.x+w.w*0.3, sy, pompe?'POMPE ●':'POMPE ○', !!pompe,'#3fb950','#484f58');
  _mState(w.x+w.w*0.75, sy, alm?'ALM ⚠':'OK ✓', !!alm,'#f85149','#3fb950');
  _drawEditOverlay(w);
}

// ─────────────────────────────────────────────────────────────────────
// SOLAR — Widget tableau de bord solaire thermique
// ─────────────────────────────────────────────────────────────────────
function rSolar(w){
  const accent='#ffd740';
  const t_capt = getV(w.varCapt||'');
  const t_ecs  = getV(w.varEcs||'');
  const t_chauf= getV(w.varChauf||'');
  const delta  = getV(w.varDelta||'');
  const pompe  = getV(w.dvPompe||'');
  const v_ecs  = getV(w.dvVanneEcs||'');
  const v_ch   = getV(w.dvVanneCh||'');
  const alm    = getV(w.dvAlm||'');

  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle=alm?'#f85149':accent+'60'; ctx.lineWidth=alm?2:1;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();
  _mHdr(w, w.label||'Solaire thermique', '☀', accent);

  const rowH=16;
  const rows=[
    {l:'T° capteur',  v:t_capt!=null?t_capt.toFixed(1):'—',  u:'°C', c:'#ffd740'},
    {l:'Ballon ECS',  v:t_ecs!=null?t_ecs.toFixed(1):'—',    u:'°C', c:'#40c4ff'},
    {l:'Ballon chauf',v:t_chauf!=null?t_chauf.toFixed(1):'—',u:'°C', c:'#ff9040'},
    {l:'ΔT capteur',  v:delta!=null?delta.toFixed(1):'—',     u:'°C', c:'#3fb950'},
  ];
  rows.forEach((r,i)=>_mRow(w.x,w.y,w.w,r.l,r.v,r.u,r.c,w.y+26+i*rowH,rowH));

  // Barre rendement (delta)
  if(delta!=null){
    const bx=w.x+8,by=w.y+26+rows.length*rowH+2,bw=w.w-16,bh=6;
    ctx.fillStyle=_bg4(); rr(ctx,bx,by,bw,bh,3); ctx.fill();
    const p=Math.min(1,Math.max(0,(delta)/30));
    ctx.fillStyle=p>0.3?'#ffd740':'#484f58'; rr(ctx,bx,by,bw*p,bh,3); ctx.fill();
    ctx.fillStyle=_t2(); ctx.font='8px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('ΔT pompe', bx, by+8);
  }

  const sy=w.y+w.h-22;
  _mState(w.x+w.w*0.2,  sy, pompe?'POMPE ●':'POMPE ○',  !!pompe, '#ffd740','#484f58');
  _mState(w.x+w.w*0.52, sy, v_ecs?'V.ECS ●':'V.ECS ○',  !!v_ecs, '#40c4ff','#484f58');
  _mState(w.x+w.w*0.8,  sy, alm?'ALM ⚠':'OK ✓',         !!alm,   '#f85149','#3fb950');
  _drawEditOverlay(w);
}

// ─────────────────────────────────────────────────────────────────────
// ZONE_CHAUF — Widget zone de chauffage
// ─────────────────────────────────────────────────────────────────────
function rZoneChauf(w){
  const accent='#69f0ae';
  const t_amb = getV(w.varRef||'');
  const sp    = getV(w.varSP||'');
  const vanne = getV(w.dvVanne||'');
  const actif = getV(w.dvActive||'');

  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle=accent+'60'; ctx.lineWidth=1;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();
  _mHdr(w, w.label||'Zone chauffage', '🏠', accent);

  // Jauge circulaire de température
  const cx=w.x+w.w/2, cy=w.y+50;
  const r=26, tMin=5, tMax=35;
  const ang0=-Math.PI*0.8, ang1=Math.PI*0.8;
  const tVal=t_amb!=null?Math.min(tMax,Math.max(tMin,t_amb)):null;
  const spVal=sp!=null?Math.min(tMax,Math.max(tMin,sp)):null;
  // Arc fond
  ctx.strokeStyle=_bg4(); ctx.lineWidth=6;
  ctx.beginPath(); ctx.arc(cx,cy,r,ang0,ang1); ctx.stroke();
  // Arc température
  if(tVal!=null){
    const a=ang0+(ang1-ang0)*((tVal-tMin)/(tMax-tMin));
    const c=(sp!=null&&t_amb<sp-0.5)?'#ff6040':'#69f0ae';
    ctx.strokeStyle=c; ctx.lineWidth=6;
    ctx.beginPath(); ctx.arc(cx,cy,r,ang0,a); ctx.stroke();
  }
  // Marqueur consigne
  if(spVal!=null){
    const a=ang0+(ang1-ang0)*((spVal-tMin)/(tMax-tMin));
    ctx.strokeStyle='#ffb300'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(cx,cy,r-8,a-0.08,a+0.08); ctx.stroke();
  }
  // Valeur centrale
  ctx.fillStyle=accent; ctx.font='bold 16px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(t_amb!=null?t_amb.toFixed(1)+'°':'—', cx, cy);
  ctx.fillStyle='#ffb300'; ctx.font='9px sans-serif'; ctx.textBaseline='top';
  ctx.fillText(sp!=null?'SP '+sp.toFixed(1)+'°':'SP —', cx, cy+14);

  const rowH=17;
  _mRow(w.x,w.y,w.w,'T° ambiante',t_amb!=null?t_amb.toFixed(1):'—','°C',accent, w.y+90, rowH);
  _mRow(w.x,w.y,w.w,'Consigne',   sp!=null?sp.toFixed(1):'—',      '°C','#ffb300', w.y+90+rowH, rowH);

  const sy=w.y+w.h-22;
  _mState(w.x+w.w*0.3, sy, vanne?'VANNE ●':'VANNE ○', !!vanne, '#69f0ae','#484f58');
  _mState(w.x+w.w*0.72,sy, actif?'ACTIF ●':'VEILLE ○', !!actif, '#ffb300','#484f58');
  _drawEditOverlay(w);
}

// ─────────────────────────────────────────────────────────────────────
// ECS_BLOC — Widget eau chaude sanitaire
// ─────────────────────────────────────────────────────────────────────
function rEcsBloc(w){
  const accent='#40c4ff';
  const t_ecs  = getV(w.varEcs||'');
  const t_prim = getV(w.varPrim||'');
  const sp     = getV(w.varSP||'');
  const pompe  = getV(w.dvPompe||'');
  const alm    = getV(w.dvAlm||'');

  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  ctx.strokeStyle=alm?'#f85149':accent+'60'; ctx.lineWidth=alm?2:1;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();
  _mHdr(w, w.label||'Eau chaude sanitaire', '💧', accent);

  // Représentation ballon cylindrique
  const tx=w.x+w.w*0.25, ty=w.y+32, tw=40, th=55;
  const fillPct=t_ecs!=null&&sp!=null? Math.min(1,Math.max(0,t_ecs/sp)):0;
  ctx.strokeStyle=accent+'80'; ctx.lineWidth=1.5;
  rr(ctx,tx,ty,tw,th,6); ctx.stroke();
  const fillH=th*fillPct;
  ctx.fillStyle=accent+(t_ecs!=null&&t_ecs>=(sp??55)-2?'cc':'44');
  ctx.fillRect(tx+1,ty+th-fillH,tw-2,fillH);
  ctx.fillStyle=accent; ctx.font='bold 11px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(t_ecs!=null?t_ecs.toFixed(0)+'°':'—', tx+tw/2, ty+th/2);
  ctx.fillStyle=_t2(); ctx.font='8px sans-serif'; ctx.textBaseline='top';
  ctx.fillText('ECS', tx+tw/2, ty+th+2);

  const rowH=16;
  const rx=w.x+tw+14;
  const rows=[
    {l:'T° ECS',    v:t_ecs!=null?t_ecs.toFixed(1):'—', u:'°C', c:accent},
    {l:'Primaire',  v:t_prim!=null?t_prim.toFixed(1):'—',u:'°C',c:'#ff9040'},
    {l:'Consigne',  v:sp!=null?sp.toFixed(1):'—',        u:'°C',c:'#ffb300'},
  ];
  rows.forEach((r,i)=>_mRow(w.x,w.y,w.w,r.l,r.v,r.u,r.c,w.y+26+i*rowH,rowH));

  const sy=w.y+w.h-22;
  _mState(w.x+w.w*0.3, sy, pompe?'POMPE ●':'POMPE ○', !!pompe,'#3fb950','#484f58');
  _mState(w.x+w.w*0.72,sy, alm?'LÉGION ⚠':'OK ✓',    !!alm,  '#f85149','#3fb950');
  _drawEditOverlay(w);
}

// ─────────────────────────────────────────────────────────────────────
// PROG_H — Widget programmation horaire Jour/Nuit + hebdomadaire
// ─────────────────────────────────────────────────────────────────────
function rProgH(w){
  const accent='#ffb300';
  const sp_act  = getV(w.varSP||'');
  const is_jour = getV(w.dvJour||'');
  const is_vac  = getV(w.dvVac||'');

  ctx.fillStyle=_bg3(); rr(ctx,w.x,w.y,w.w,w.h,10); ctx.fill();
  const modeColor = is_vac?'#40c4ff': is_jour?'#ffb300':'#5c6bc0';
  ctx.strokeStyle=modeColor+'80'; ctx.lineWidth=1.5;
  rr(ctx,w.x,w.y,w.w,w.h,10); ctx.stroke();

  // Header
  _mHdr(w, w.label||'Planning Jour/Nuit', '📅', accent);

  // Badge mode
  const modeLabel = is_vac?'🏖 VACANCES': is_jour?'☀ JOUR':'🌙 NUIT';
  const my=w.y+28;
  ctx.fillStyle=modeColor+'20'; rr(ctx,w.x+6,my,w.w-12,20,5); ctx.fill();
  ctx.strokeStyle=modeColor; ctx.lineWidth=1; rr(ctx,w.x+6,my,w.w-12,20,5); ctx.stroke();
  ctx.fillStyle=modeColor; ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(modeLabel, w.x+w.w/2, my+10);

  // Calendrier hebdomadaire (si données disponibles)
  const jours=['L','M','M','J','V','S','D'];
  const now=new Date();
  const todayWd=now.getDay()===0?6:now.getDay()-1; // 0=Lun
  const dayW=Math.floor((w.w-12)/7);
  const calY=w.y+54;

  for(let i=0;i<7;i++){
    const dx=w.x+6+i*dayW;
    const dayActive=(w.days&&w.days[i]!==undefined)?w.days[i]:true;
    const isToday=i===todayWd;
    const bg=isToday?(is_vac?'#40c4ff30':is_jour?'#ffb30040':'#5c6bc040')
                    :(dayActive?'#1c2128':'#0d1117');
    ctx.fillStyle=bg; rr(ctx,dx,calY,dayW-2,36,3); ctx.fill();
    if(isToday){ctx.strokeStyle=modeColor;ctx.lineWidth=1.5;rr(ctx,dx,calY,dayW-2,36,3);ctx.stroke();}
    ctx.fillStyle=dayActive?(isToday?modeColor:'#8b949e'):'#484f58';
    ctx.font=`${isToday?'bold ':''}9px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(jours[i],dx+dayW/2-1,calY+3);
    // Barre plage jour
    if(dayActive){
      const hD=(w.hDebuts&&w.hDebuts[i]!==undefined)?w.hDebuts[i]:w.hDebut??6.5;
      const hF=(w.hFins&&w.hFins[i]!==undefined)?w.hFins[i]:w.hFin??22;
      const bh=8, by=calY+18;
      ctx.fillStyle='#30363d'; ctx.fillRect(dx+2,by,dayW-6,bh);
      const p1=Math.max(0,(hD/24)); const p2=Math.min(1,(hF/24));
      ctx.fillStyle=dayActive?'#ffb30090':'#484f5860';
      ctx.fillRect(dx+2+(dayW-6)*p1,by,(dayW-6)*(p2-p1),bh);
    }
  }

  // Timeline 24h de la journée courante (utilise l'horaire spécifique du jour)
  const bx=w.x+6, by2=w.y+100, bw=w.w-12, bh2=8;
  ctx.fillStyle='#1c2128'; rr(ctx,bx,by2,bw,bh2,3); ctx.fill();
  const hD=(w.hDebuts&&w.hDebuts[todayWd]!==undefined)?w.hDebuts[todayWd]:(w.hDebut??6.5);
  const hF=(w.hFins&&w.hFins[todayWd]!==undefined)?w.hFins[todayWd]:(w.hFin??22);
  const px1=bx+bw*(hD/24), px2=bx+bw*(hF/24);
  ctx.fillStyle='#ffb30060';
  if(px2>px1) ctx.fillRect(px1,by2,px2-px1,bh2);
  const nowH=now.getHours()+now.getMinutes()/60;
  const px=bx+bw*(nowH/24);
  ctx.strokeStyle='#ffffff80'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(px,by2-2); ctx.lineTo(px,by2+bh2+2); ctx.stroke();
  // Afficher l'horaire du jour
  const _fmt=(h)=>{const hh=Math.floor(h),mm=Math.round((h-hh)*60);return`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;};
  ctx.fillStyle=_t2(); ctx.font='8px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText(_fmt(hD),bx,by2+bh2+2);
  ctx.textAlign='center'; ctx.fillText('|',bx+bw/2,by2+bh2+2);
  ctx.textAlign='right';  ctx.fillText(_fmt(hF),bx+bw,by2+bh2+2);

  // SP actif + heure
  const sy2=w.y+w.h-24;
  _mRow(w.x,w.y,w.w,'SP actif',sp_act!=null?sp_act.toFixed(1):'—','°C','#ffb300',sy2,16);
  const hh=now.getHours().toString().padStart(2,'0')+':'+now.getMinutes().toString().padStart(2,'0');
  _mRow(w.x,w.y,w.w,'Heure',hh,'',_t2(),sy2+16,16);

  _drawEditOverlay(w);
}


// ════════════════════════════════════════════════════════════════════
// ── GÉNÉRATEUR DE PAGES SYNOPTIQUES MÉTIER ──────────────────────
// ── Appelé depuis le menu principal du studio ────────────────────
// ════════════════════════════════════════════════════════════════════
window.addMetierPages = function(){
  const C = 240;  // couleur de fond commune
  const bg = '#0d1117';
  const ts = Date.now();

  // ── Page 1 : PLANCHER CHAUFFANT ───────────────────────────────
  const pagePlancher = {
    id:'MP_plancher_'+ts, name:'🔥 Plancher', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pagePlancher.widgets = [
    {id:'WMP1',type:'label',x:20,y:12,w:340,h:28,text:'Plancher chauffant',fontSize:18,bold:true,color:'#ff7043',bg:'',align:'left'},
    {id:'WMP2',type:'plancher_w',x:20,y:50,w:240,h:165,label:'Plancher chauffant',varRef:'',varSP:'RF5',varDep:'RF9',varRet:'RF10',dvCirc:'k2',dvV3v:'k1',dvErr:''},
    {id:'WMP3',type:'gauge',x:275,y:50,w:130,h:130,label:'T° Ambiante',varRef:'',unit:'°C',color:'#ff7043',bg:'#0d1117',min:0,max:35},
    {id:'WMP4',type:'setpoint',x:275,y:190,w:130,h:50,label:'Consigne',varRef:'RF5',unit:'°C',color:'#ffb300',min:10,max:30,step:0.5},
    {id:'WMP5',type:'relay',x:20,y:228,w:120,h:40,label:'Circulateur',varRef:'k2',onLabel:'MARCHE',offLabel:'Arrêt',color:'#3fb950'},
    {id:'WMP6',type:'relay',x:150,y:228,w:120,h:40,label:'Vanne V3V',varRef:'k1',onLabel:'OUVERT',offLabel:'Fermé',color:'#ffb300'},
    {id:'WMP7',type:'value',x:20,y:278,w:120,h:50,label:'T° départ',varRef:'RF9',unit:'°C',color:'#ff6040',decimals:1},
    {id:'WMP8',type:'value',x:150,y:278,w:120,h:50,label:'T° retour',varRef:'RF10',unit:'°C',color:'#40a0ff',decimals:1},
    {id:'WMP9',type:'prog_h_w',x:20,y:340,w:385,h:140,label:'Planning',varSP:'RF5',dvJour:'',dvVac:'',hDebut:6.5,hFin:22},
    {id:'WMP10',type:'nav_back',x:20,y:495,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // ── Page 2 : CHAUDIÈRE ─────────────────────────────────────────
  const pageChaud = {
    id:'MP_chaud_'+ts, name:'🔥 Chaudière', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pageChaud.widgets = [
    {id:'WMC1',type:'label',x:20,y:12,w:340,h:28,text:'Chaudière',fontSize:18,bold:true,color:'#ff5252',bg:'',align:'left'},
    {id:'WMC2',type:'chaudiere_w',x:20,y:50,w:220,h:160,label:'Chaudière',varRet:'RF1',varDep:'RF2',varSP:'',dvBrulee:'k3',dvPompe:'k4',dvAlm:''},
    {id:'WMC3',type:'gauge',x:255,y:50,w:130,h:130,label:'T° retour',varRef:'RF1',unit:'°C',color:'#ff5252',bg:'#0d1117',min:0,max:90},
    {id:'WMC4',type:'value',x:255,y:190,w:130,h:50,label:'T° départ',varRef:'RF2',unit:'°C',color:'#ff6040',decimals:1},
    {id:'WMC5',type:'relay',x:20,y:225,w:130,h:40,label:'Brûleur',varRef:'k3',onLabel:'EN CHAUFFE',offLabel:'Arrêt',color:'#ff5252'},
    {id:'WMC6',type:'relay',x:160,y:225,w:130,h:40,label:'Pompe circuit',varRef:'k4',onLabel:'MARCHE',offLabel:'Arrêt',color:'#3fb950'},
    {id:'WMC7',type:'alarm_light',x:20,y:278,w:60,h:60,label:'Alarme',varRef:'',colorOn:'#f85149',colorOff:'#484f58'},
    {id:'WMC8',type:'trend',x:90,y:278,w:295,h:90,label:'T° retour',varRef:'RF1',unit:'°C',color:'#ff5252'},
    {id:'WMC9',type:'nav_back',x:20,y:355,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // ── Page 3 : SOLAIRE THERMIQUE ────────────────────────────────
  const pageSolar = {
    id:'MP_solar_'+ts, name:'☀ Solaire', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pageSolar.widgets = [
    {id:'WMS1',type:'label',x:20,y:12,w:380,h:28,text:'Solaire thermique',fontSize:18,bold:true,color:'#ffd740',bg:'',align:'left'},
    {id:'WMS2',type:'solar_w',x:20,y:50,w:240,h:175,label:'Solaire thermique',varCapt:'RF0',varEcs:'RF3',varChauf:'',varDelta:'RF12',dvPompe:'k1',dvVanneEcs:'k2',dvVanneCh:'k3',dvAlm:''},
    {id:'WMS3',type:'gauge',x:275,y:50,w:130,h:130,label:'T° capteur',varRef:'RF0',unit:'°C',color:'#ffd740',bg:'#0d1117',min:0,max:120},
    {id:'WMS4',type:'value',x:275,y:192,w:130,h:45,label:'ΔT capteur',varRef:'RF12',unit:'°C',color:'#3fb950',decimals:1},
    {id:'WMS5',type:'relay',x:20,y:238,w:120,h:40,label:'Pompe solaire',varRef:'k1',onLabel:'MARCHE',offLabel:'Arrêt',color:'#ffd740'},
    {id:'WMS6',type:'relay',x:150,y:238,w:120,h:40,label:'Vanne ECS',varRef:'k2',onLabel:'ECS',offLabel:'Arrêt',color:'#40c4ff'},
    {id:'WMS7',type:'relay',x:280,y:238,w:120,h:40,label:'Vanne Chauf',varRef:'k3',onLabel:'CHAUF',offLabel:'Arrêt',color:'#ff9040'},
    {id:'WMS8',type:'temperature',x:20,y:292,w:120,h:90,label:'Ballon ECS',varRef:'RF3',alarmHigh:70,alarmLow:40,color:'#40c4ff'},
    {id:'WMS9',type:'trend',x:150,y:292,w:250,h:90,label:'T° capteur',varRef:'RF0',unit:'°C',color:'#ffd740'},
    {id:'WMS10',type:'nav_back',x:20,y:395,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // ── Page 4 : ZONE CHAUFFAGE ───────────────────────────────────
  const pageZone = {
    id:'MP_zone_'+ts, name:'🏠 Zone', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pageZone.widgets = [
    {id:'WMZ1',type:'label',x:20,y:12,w:340,h:28,text:'Zone de chauffage',fontSize:18,bold:true,color:'#69f0ae',bg:'',align:'left'},
    {id:'WMZ2',type:'zone_chauf_w',x:20,y:50,w:210,h:165,label:'Zone chauffage',varRef:'RF0',varSP:'RF5',dvVanne:'k5',dvActive:''},
    {id:'WMZ3',type:'gauge',x:245,y:50,w:150,h:150,label:'T° ambiante',varRef:'RF0',unit:'°C',color:'#69f0ae',bg:'#0d1117',min:10,max:30},
    {id:'WMZ4',type:'setpoint',x:245,y:212,w:150,h:50,label:'Consigne pièce',varRef:'RF5',unit:'°C',color:'#ffb300',min:12,max:28,step:0.5},
    {id:'WMZ5',type:'relay',x:20,y:228,w:140,h:40,label:'Vanne zone',varRef:'k5',onLabel:'OUVERTE',offLabel:'Fermée',color:'#69f0ae'},
    {id:'WMZ6',type:'prog_h_w',x:20,y:280,w:375,h:130,label:'Planning',varSP:'RF5',dvJour:'',dvVac:'',hDebut:6.5,hFin:22},
    {id:'WMZ7',type:'nav_back',x:20,y:424,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // ── Page 5 : ECS ──────────────────────────────────────────────
  const pageEcs = {
    id:'MP_ecs_'+ts, name:'💧 ECS', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pageEcs.widgets = [
    {id:'WME1',type:'label',x:20,y:12,w:340,h:28,text:'Eau chaude sanitaire',fontSize:18,bold:true,color:'#40c4ff',bg:'',align:'left'},
    {id:'WME2',type:'ecs_w',x:20,y:50,w:220,h:165,label:'ECS',varEcs:'RF3',varPrim:'RF4',varSP:'',dvPompe:'k6',dvAlm:''},
    {id:'WME3',type:'gauge',x:255,y:50,w:140,h:140,label:'T° ECS',varRef:'RF3',unit:'°C',color:'#40c4ff',bg:'#0d1117',min:30,max:80},
    {id:'WME4',type:'temperature',x:255,y:200,w:140,h:70,label:'T° primaire',varRef:'RF4',alarmHigh:90,alarmLow:30,color:'#ff9040'},
    {id:'WME5',type:'relay',x:20,y:228,w:130,h:40,label:'Pompe ECS',varRef:'k6',onLabel:'MARCHE',offLabel:'Arrêt',color:'#3fb950'},
    {id:'WME6',type:'alarm_light',x:160,y:228,w:60,h:40,label:'Anti-légio',varRef:'',colorOn:'#ffd740',colorOff:'#484f58'},
    {id:'WME7',type:'trend',x:20,y:282,w:375,h:90,label:'T° ECS',varRef:'RF3',unit:'°C',color:'#40c4ff'},
    {id:'WME8',type:'nav_back',x:20,y:385,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // ── Page 6 : PLANNING JOUR/NUIT ───────────────────────────────
  const pagePlanning = {
    id:'MP_planning_'+ts, name:'📅 Planning', widgets:[], background:bg,
    bgImage:null, bgImageOpacity:0.8, bgImageFit:'cover', grid:20
  };
  pagePlanning.widgets = [
    {id:'WMPl1',type:'label',x:20,y:12,w:380,h:28,text:'Programmation Jour / Nuit',fontSize:18,bold:true,color:'#ffb300',bg:'',align:'left'},
    {id:'WMPl2',type:'prog_h_w',x:20,y:50,w:380,h:140,label:'Planning horaire',varSP:'RF5',dvJour:'',dvVac:'',hDebut:6.5,hFin:22},
    {id:'WMPl3',type:'value',x:20,y:205,w:120,h:55,label:'SP actif',varRef:'RF5',unit:'°C',color:'#ffb300',decimals:1},
    {id:'WMPl4',type:'relay',x:150,y:205,w:130,h:55,label:'Mode JOUR',varRef:'',onLabel:'☀ JOUR',offLabel:'🌙 Nuit',color:'#ffb300'},
    {id:'WMPl5',type:'relay',x:290,y:205,w:110,h:55,label:'Vacances',varRef:'',onLabel:'🏖 VAC',offLabel:'Normal',color:'#40c4ff'},
    {id:'WMPl6',type:'setpoint',x:20,y:272,w:120,h:55,label:'SP Jour',varRef:'RF5',unit:'°C',color:'#ffb300',min:15,max:26,step:0.5},
    {id:'WMPl7',type:'label',x:20,y:340,w:380,h:1,text:'',bg:'#30363d'},
    {id:'WMPl8',type:'label',x:20,y:350,w:380,h:20,text:'Connecter PROG_H → reg_sp=RF5 · out_jour → variable DV JOUR · cond_vac → M0 pour activer les commandes ci-dessus',fontSize:9,bold:false,color:'#484f58',bg:'',align:'left'},
    {id:'WMPl9',type:'nav_back',x:20,y:382,w:120,h:36,label:'Retour',icon:'←',shape:'rect',color:'#475569',bg:'#1e293b'},
  ];

  // Injecter toutes les pages
  [pagePlancher, pageChaud, pageSolar, pageZone, pageEcs, pagePlanning].forEach(p => pages.push(p));
  _dirty = true;
  renderPagesBar();
  toast('✅ 6 pages métier ajoutées !', 'ok');
};

// ── Exposer dans le menu via pybridge ──────────────────────────────
window.addMetierPagesBtn = function(){
  if(confirm('Ajouter 6 pages synoptiques pré-construites ?\n(Plancher · Chaudière · Solaire · Zone · ECS · Planning)\n\nLes pages s\'ajoutent à la fin du projet existant.')){
    window.addMetierPages();
  }
};
