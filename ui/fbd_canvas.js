

// ════════════════════════════════════════════════════════════
// DÉFINITIONS
// ════════════════════════════════════════════════════════════
const DEFS = {
  // E/S
  INPUT:    {cat:'E/S',        col:'#0d1f35',hdr:'#1a2f45',bdg:'#58a6ff',ins:[],           outs:['VAL'],    desc:'Entrée GPIO'},
  OUTPUT:   {cat:'E/S',        col:'#1f2d0d',hdr:'#2a3d10',bdg:'#3fb950',ins:['VAL'],       outs:[],         desc:'Sortie GPIO'},
  CONST:    {cat:'E/S',        col:'#2a1f0a',hdr:'#352810',bdg:'#d29922',ins:[],            outs:['VAL'],    desc:'Constante'},
  MEM:      {cat:'E/S',        col:'#1a1a2a',hdr:'#252535',bdg:'#bc8cff',ins:['W'],         outs:['R'],      desc:'Bit mémoire'},
  // Connecteurs inter-pages
  PAGE_IN:  {cat:'Connecteurs',col:'#0a2a1a',hdr:'#103520',bdg:'#39d353',ins:[],            outs:['SIG'],    desc:'Signal entrant (page)'},
  PAGE_OUT: {cat:'Connecteurs',col:'#2a1a0a',hdr:'#352010',bdg:'#f0883e',ins:['SIG'],       outs:[],         desc:'Signal sortant (page)'},
  CONN:     {cat:'Connecteurs',col:'#0a1a2a',hdr:'#102030',bdg:'#58a6ff',ins:['IN'],        outs:['OUT'],    desc:'Connecteur numéroté'},
  GROUP:    {cat:'Groupes',    col:'#1a0a35',hdr:'#2a1050',bdg:'#bc8cff',ins:[],           outs:[],         desc:'Bloc groupe (Ctrl+G)'},
  GROUP_IN: {cat:'Groupes',    col:'#0a1a35',hdr:'#102030',bdg:'#58a6ff',ins:[],           outs:['SIG'],    desc:'Port entrée du groupe'},
  GROUP_OUT:{cat:'Groupes',    col:'#0a2a10',hdr:'#103510',bdg:'#3fb950',ins:['IN'],        outs:[],         desc:'Port sortie du groupe'},
  // Logique
  AND:      {cat:'Logique',    col:'#1f3a5f',hdr:'#2a4a70',bdg:'#58a6ff',ins:['IN1','IN2'],outs:['OUT'],    desc:'ET logique'},
  OR:       {cat:'Logique',    col:'#1f3a5f',hdr:'#2a4a70',bdg:'#58a6ff',ins:['IN1','IN2'],outs:['OUT'],    desc:'OU logique'},
  NOT:      {cat:'Logique',    col:'#1f2a4a',hdr:'#2a3a5f',bdg:'#8b949e',ins:['IN'],        outs:['OUT'],    desc:'Inverseur (NON)'},
  // Bobines
  COIL:     {cat:'Bobines',    col:'#3d1f0a',hdr:'#4a2810',bdg:'#f0883e',ins:['EN'],        outs:['Q'],      desc:'Bobine'},
  SET:      {cat:'Bobines',    col:'#0a2a0a',hdr:'#103510',bdg:'#3fb950',ins:['S'],         outs:['Q'],      desc:'Mémorise 1'},
  RESET:    {cat:'Bobines',    col:'#2a0a0a',hdr:'#350f0f',bdg:'#f85149',ins:['R'],         outs:['Q'],      desc:'Mémorise 0'},
  MOVE:     {cat:'Bobines',    col:'#1a2a2a',hdr:'#253535',bdg:'#8b949e',ins:['IN','EN'],   outs:['OUT'],    desc:'Affectation'},
  // Temps
  TON:      {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#bc8cff',ins:['IN','PT'],   outs:['Q','ET'], desc:'Tempo ON-delay'},
  TOF:      {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#bc8cff',ins:['IN','PT'],   outs:['Q','ET'], desc:'Tempo OFF-delay'},
  TP:       {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#bc8cff',ins:['IN','PT'],   outs:['Q','ET'], desc:'Impulsion'},
  // Compteurs
  CTU:      {cat:'Compteurs',  col:'#0a2a1a',hdr:'#103520',bdg:'#39d353',ins:['CU','R','PV'],outs:['Q','CV'],desc:'Compteur UP'},
  CTD:      {cat:'Compteurs',  col:'#0a2a1a',hdr:'#103520',bdg:'#39d353',ins:['CD','LD','PV'],outs:['Q','CV'],desc:'Compteur DOWN'},
  CTUD:     {cat:'Compteurs',  col:'#0a2a1a',hdr:'#103520',bdg:'#39d353',ins:['CU','CD','R','LD','PV'],outs:['Q','CV'],desc:'Compteur UP/DOWN'},
  // Comparaison
  GT:       {cat:'Comparaison',col:'#2a2a0a',hdr:'#353510',bdg:'#d29922',ins:['IN1','IN2'],outs:['OUT'],    desc:'IN1 > IN2'},
  GE:       {cat:'Comparaison',col:'#2a2a0a',hdr:'#353510',bdg:'#d29922',ins:['IN1','IN2'],outs:['OUT'],    desc:'IN1 ≥ IN2'},
  LT:       {cat:'Comparaison',col:'#2a2a0a',hdr:'#353510',bdg:'#d29922',ins:['IN1','IN2'],outs:['OUT'],    desc:'IN1 < IN2'},
  EQ:       {cat:'Comparaison',col:'#2a2a0a',hdr:'#353510',bdg:'#d29922',ins:['IN1','IN2'],outs:['OUT'],    desc:'IN1 = IN2'},
  // Analogique
  PT_IN:    {cat:'Analogique', col:'#0a1f2a',hdr:'#102535',bdg:'#00d4ff',ins:[],            outs:['TEMP','FAULT'],desc:'Sonde PT100/PT1000'},
  ANA_IN:   {cat:'Analogique', col:'#0a1a2a',hdr:'#102030',bdg:'#58cfff',ins:[],            outs:['VAL'],        desc:'Entrée ADS1115 (0-5V)'},
  COMPARE_F:{cat:'Analogique', col:'#2a1f0a',hdr:'#352810',bdg:'#ffaa00',ins:['IN','SP'],   outs:['GT','LT','EQ'],desc:'Comparaison flottante'},
  SCALE:    {cat:'Analogique', col:'#1a2a1a',hdr:'#203520',bdg:'#80ff80',ins:['IN'],        outs:['OUT'],        desc:'Mise à l\'échelle'},
  PID:      {cat:'Analogique', col:'#1a0a2a',hdr:'#250f35',bdg:'#d080ff',ins:['PV','SP','EN'],outs:['OUT','ERR'], desc:'Régulateur PID'},
  // Analogique avancé (Proview)
  SENSOR:   {cat:'Analogique', col:'#0a2020',hdr:'#103030',bdg:'#00ffe0',ins:[],            outs:['VAL'],        desc:'Capteur température (SensorFo)'},
  ADD:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Addition'},
  SUB:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Soustraction'},
  MUL:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Multiplication'},
  DIV:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Division'},
  MUX:      {cat:'Calcul',     col:'#0a1a2a',hdr:'#102030',bdg:'#58a6ff',ins:['IDX','IN0','IN1','IN2','IN3'],outs:['VAL'],desc:'Multiplexeur analogique (index RF ou M)'},
  COMPH:    {cat:'Calcul',     col:'#2a1a0a',hdr:'#351f10',bdg:'#ff8040',ins:['IN','HIG'],  outs:['HL'],         desc:'Comparateur seuil HAUT avec hystérésis'},
  COMPL:    {cat:'Calcul',     col:'#0a1a2a',hdr:'#10201a',bdg:'#40a0ff',ins:['IN','LOW'],  outs:['LL'],         desc:'Comparateur seuil BAS avec hystérésis'},
  ABS:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN'],        outs:['OUT'],        desc:'Valeur absolue |IN|'},
  MIN:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Minimum de deux valeurs'},
  MAX:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Maximum de deux valeurs'},
  MOD:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN1','IN2'], outs:['OUT'],        desc:'Modulo IN1 % IN2'},
  SQRT:     {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['IN'],        outs:['OUT'],        desc:'Racine carrée √IN'},
  POW:      {cat:'Calcul',     col:'#1a2a0a',hdr:'#253510',bdg:'#b0ff80',ins:['BASE','EXP'],outs:['OUT'],        desc:'Puissance BASE^EXP'},
  CLAMP:    {cat:'Calcul',     col:'#2a2a0a',hdr:'#353510',bdg:'#ffe040',ins:['IN'],        outs:['OUT','CLIP'],  desc:'Limitation (min/max)'},
  CLAMP_A:  {cat:'Calcul',     col:'#2a2a0a',hdr:'#353510',bdg:'#ffe040',ins:['IN'],        outs:['OUT','CLIP'],  desc:'Limitation analogique (alias CLAMP)'},
  SEL:      {cat:'Calcul',     col:'#2a0a2a',hdr:'#350f35',bdg:'#cc80ff',ins:['G','IN0','IN1'],outs:['OUT'],     desc:'Sélecteur (G=0→IN0, G=1→IN1)'},
  // Traitement analogique avancé (Proview)
  FILT1:    {cat:'Analogique', col:'#0a2a20',hdr:'#103530',bdg:'#00ffcc',ins:['IN'],        outs:['OUT'],        desc:'Filtre passe-bas 1er ordre'},
  AVG:      {cat:'Analogique', col:'#0a2020',hdr:'#103030',bdg:'#00e0aa',ins:['IN'],        outs:['OUT'],        desc:'Moyenne glissante sur N échantillons'},
  INTEG:    {cat:'Analogique', col:'#1a0a2a',hdr:'#250f35',bdg:'#d080ff',ins:['IN','RES'],  outs:['OUT','MAX'],  desc:'Intégrateur (∫ IN·dt)'},
  DERIV:    {cat:'Analogique', col:'#1a0a2a',hdr:'#250f35',bdg:'#d080ff',ins:['IN'],        outs:['OUT'],        desc:'Dérivateur (dIN/dt)'},
  DEADB:    {cat:'Analogique', col:'#2a1a0a',hdr:'#351f10',bdg:'#ff9040',ins:['IN'],        outs:['OUT','DEAD'], desc:'Zone morte (Dead Band)'},
  RAMP:     {cat:'Analogique', col:'#2a2a0a',hdr:'#353510',bdg:'#ffe040',ins:['SP'],        outs:['OUT','DONE'], desc:'Rampe limitée en vitesse'},
  HYST:     {cat:'Analogique', col:'#2a0a0a',hdr:'#350f0f',bdg:'#ff4040',ins:['IN'],        outs:['OUT'],        desc:'Hystérésis autour d\'un seuil'},
  // Logique avancée (Proview)
  XOR:      {cat:'Logique',    col:'#1f3a5f',hdr:'#2a4a70',bdg:'#58a6ff',ins:['IN1','IN2'],outs:['OUT'],         desc:'OU exclusif (XOR)'},
  INV:      {cat:'Logique',    col:'#1f2a4a',hdr:'#2a3a5f',bdg:'#8b949e',ins:['IN'],       outs:['OUT'],         desc:'Inverseur (alias NOT)'},
  // Temps avancés (Proview)
  WAIT:     {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#bc8cff',ins:['IN'],        outs:['Q'],          desc:'Délai fixe (Wait/Pulse)'},
  WAITH:    {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#9070d0',ins:['IN'],        outs:['STS'],         desc:'Tempo désactivation (WaitH)'},
  PULSE:    {cat:'Temps',      col:'#1f0a3d',hdr:'#2a1050',bdg:'#e060ff',ins:['IN'],        outs:['Q'],           desc:'Impulsion courte'},
  // Persistance / Horloge
  BACKUP:   {cat:'Variables',  col:'#2a2a1a',hdr:'#353520',bdg:'#d4c800',ins:['VAL'],         outs:['VAL'],         desc:'Valeur persistante — port VAL bidirectionnel'},
  AV:       {cat:'Variables',  col:'#1a2a1a',hdr:'#203510',bdg:'#90d060',ins:[],             outs:['OUT'],         desc:'Variable analogique (Av)'},
  DV:       {cat:'Variables',  col:'#1a1a2a',hdr:'#202035',bdg:'#8090ff',ins:[],             outs:['OUT'],         desc:'Variable TOR (Dv)'},
  STOAV:    {cat:'Variables',  col:'#2a1a0a',hdr:'#351f10',bdg:'#ffa030',ins:['IN'],        outs:[],              desc:'Écriture variable analogique'},
  STOAP:    {cat:'Variables',  col:'#2a1a0a',hdr:'#351f10',bdg:'#ff8020',ins:['IN'],        outs:[],              desc:'Écriture paramètre timer'},
  LOCALTIME:{cat:'Variables',  col:'#0a2a2a',hdr:'#103535',bdg:'#00d4aa',ins:[],            outs:['HOUR','MDAY','WDAY'],desc:'Heure locale (LocalTime)'},
  SR_R:     {cat:'Logique',    col:'#2a0a2a',hdr:'#350f35',bdg:'#cc70ff',ins:['SET','RES'], outs:['STS'],         desc:'Bascule SR avec Reset prioritaire'},
  SR_S:     {cat:'Logique',    col:'#2a0a1a',hdr:'#350f20',bdg:'#ff70cc',ins:['SET','RES'], outs:['STS'],         desc:'Bascule SR avec Set prioritaire'},
  // Bloc arithmétique Proview (CArithm)
  CARITHM:  {cat:'Arithmétique',col:'#1a0a0a',hdr:'#2a1010',bdg:'#ff4040',ins:['A1','A2','A3','A4','d1','d2','d3','d4','I1','I2'],outs:['OA1','OA2','od1','od2','od3'],desc:'Bloc arithmétique (code C embarqué)'},
  // Contacteur / Vanne
  // ── Blocs Métier ────────────────────────────────────────────────────────────
  PLANCHER:   {cat:'Métier', col:'#0a1a2a',hdr:'#0d2035',bdg:'#ff7043',
               ins:['T_AMB','T_DEP','T_RET','SP','EN'],
               outs:['V3V_OUV','V3V_FER','CIRC','ERR'],
               desc:'Plancher chauffant PID — T amb + départ + retour + V3V + circulateur'},
  CHAUDIERE:  {cat:'Métier', col:'#1a0a0a',hdr:'#251010',bdg:'#ff5252',
               ins:['TEMP_R','TEMP_D','SP','EN'], outs:['BRULEE','POMPE','ALM'],
               desc:'Régulation chaudière avec sécurités'},
  SOLAR:      {cat:'Métier', col:'#1a1500',hdr:'#2a2000',bdg:'#ffd740',
               ins:['T_CAPT','T_BALLON_ECS','T_BALLON_CHAUF','EN'],
               outs:['POMPE','VANNE_ECS','VANNE_CHAUF','ALM'],
               desc:'Solaire thermique — ΔT capteur/ballon, vanne directionnelle ECS/chauffage'},
  ZONE_CHAUF: {cat:'Métier', col:'#0a1a0a',hdr:'#102510',bdg:'#69f0ae',
               ins:['TEMP','SP','EN'], outs:['VANNE','ACTIVE'],
               desc:'Zone de chauffage — vanne motorisée + hystérésis'},
  ECS_BLOC:   {cat:'Métier', col:'#0a0a2a',hdr:'#101035',bdg:'#40c4ff',
               ins:['TEMP_ECS','TEMP_PRIM','EN'], outs:['POMPE','ALM_LEG'],
               desc:'Préparation ECS avec anti-légionellose'},

  PYBLOCK:  {cat:'Arithmétique',col:'#0a0a25',hdr:'#10102a',bdg:'#7c3aed',ins:['A1','A2','A3','A4','d1','d2','d3','d4'],outs:['OA1','OA2','od1','od2','od3'],desc:'Bloc Python natif — accès complet aux variables PLC'},
  CONTACTOR:{cat:'Actionneurs',col:'#0a1f0a',hdr:'#102a10',bdg:'#40ff80',ins:['ON'],        outs:['Q'],           desc:'Contacteur/Relais (ContactorFo)'},
  VALVE3V:  {cat:'Actionneurs',col:'#1a0f0a',hdr:'#251510',bdg:'#ff8040',ins:['OINC','ODEC'],outs:['Q_OUV','Q_FER'],desc:'Vanne 3 voies — Q_OUV=ouverture, Q_FER=fermeture'},
  // Compteur de marche
  RUNTIMCNT:{cat:'Compteurs',  col:'#0a2a0a',hdr:'#103510',bdg:'#50ff50',ins:['RUN','RST'], outs:['STARTS','TOTAL','RUNTIME'],desc:'Compteur marche — RUN=signal, RST=reset'},
};

// ════════════════════════════════════════════════════════════
// SYSTÈME DE GROUPES
// ════════════════════════════════════════════════════════════
// groupStack : pile de navigation {pageIdx, groupBlockId}
// quand non vide, on est à l'intérieur d'un groupe
let groupStack = [];

function _groupPageId(blockId){ return '__grp_' + blockId; }

function enterGroup(grpBlock){
  // Chercher ou créer la page interne du groupe
  let gPageId = _groupPageId(grpBlock.id);
  let gPageIdx = pages.findIndex(p=>p.id===gPageId);
  if(gPageIdx < 0){
    // Créer page interne vide
    const gPage = {id:gPageId, name:grpBlock.params.name||'Groupe', blocks:[], wires:[]};
    // Si le groupe a déjà des blocs internes sauvegardés
    if(grpBlock.params._inner_blocks){
      try{
        const saved = JSON.parse(grpBlock.params._inner_blocks);
        saved.blocks.forEach(bd=>{ const b=Object.assign({},bd); updPorts(b); gPage.blocks.push(b); });
        saved.wires.forEach(wd=>{
          const sb=gPage.blocks.find(b=>b.id===wd.src.bid);
          const db=gPage.blocks.find(b=>b.id===wd.dst.bid);
          if(sb&&db){const w={...wd,src:{...wd.src},dst:{...wd.dst},_src:sb,_dst:db};gPage.wires.push(w);}
        });
      }catch(e){}
    }
    pages.push(gPage);
    gPageIdx = pages.length - 1;
  }
  groupStack.push({returnPageIdx: cur, groupBlockId: grpBlock.id});
  goPage(gPageIdx);
  updateGroupBreadcrumb();
}

function exitGroup(){
  if(!groupStack.length) return;
  const {returnPageIdx, groupBlockId} = groupStack.pop();
  // Sauvegarder le contenu de la page groupe dans le bloc GROUP
  const curPage = pages[cur];
  const grpBlock = pages[returnPageIdx].blocks.find(b=>b.id===groupBlockId);
  if(grpBlock && curPage){
    const snap = {
      blocks: curPage.blocks.map(b=>({...b,params:{...b.params}})),
      wires:  curPage.wires.map(w=>({...w,src:{...w.src},dst:{...w.dst}}))
    };
    grpBlock.params._inner_blocks = JSON.stringify(snap);
    // Recalculer les ports du bloc GROUP depuis les blocs GROUP_IN/GROUP_OUT internes
    _updateGroupPorts(grpBlock, curPage);
  }
  // Supprimer la page interne (elle est sauvegardée dans le bloc)
  const gPageId = _groupPageId(groupBlockId);
  const gIdx = pages.findIndex(p=>p.id===gPageId);
  if(gIdx>=0) pages.splice(gIdx,1);
  goPage(returnPageIdx < pages.length ? returnPageIdx : pages.length-1);
  updateGroupBreadcrumb();
  notifyChange();
}

function _updateGroupPorts(grpBlock, innerPage){
  // Lire les blocs GROUP_IN et GROUP_OUT internes pour générer les ports
  const ins  = innerPage.blocks.filter(b=>b.type==='GROUP_IN').sort((a,b)=>a.y-b.y);
  const outs = innerPage.blocks.filter(b=>b.type==='GROUP_OUT').sort((a,b)=>a.y-b.y);
  grpBlock.params._port_ins  = ins.map(b=>b.params.label||b.id);
  grpBlock.params._port_outs = outs.map(b=>b.params.label||b.id);
  updPorts(grpBlock);
}

function updateGroupBreadcrumb(){
  const bc = document.getElementById('grp-breadcrumb');
  if(!bc) return;
  if(!groupStack.length){ bc.style.display='none'; return; }
  bc.style.display='flex';
  let html = '<span style="cursor:pointer;color:#bc8cff" onclick="exitAllGroups()">Programme</span>';
  groupStack.forEach((g,i)=>{
    const page = pages[pages.findIndex(p=>p.id===_groupPageId(g.groupBlockId))];
    const name = page ? page.name : '?';
    html += ' <span style="color:#484f58">›</span> ';
    if(i < groupStack.length-1)
      html += `<span style="cursor:pointer;color:#bc8cff" onclick="exitToLevel(${i})">${name}</span>`;
    else
      html += `<span style="color:#bc8cff;font-weight:600">${name}</span>`;
  });
  bc.innerHTML = html;
  const btnExit = document.getElementById('btn-exit-group');
  if(btnExit) btnExit.style.display = groupStack.length ? 'inline-block' : 'none';
}

function exitAllGroups(){
  while(groupStack.length) exitGroup();
}
function exitToLevel(level){
  while(groupStack.length > level+1) exitGroup();
}

function groupSelected(){
  if(multiSel.size < 1 && !selB){ alert('Sélectionner au moins un bloc (Ctrl+A ou sélection rectangle)'); return; }
  const toGroup = multiSel.size > 0 ? [...multiSel] : [selB];
  const name = prompt('Nom du groupe :', 'Groupe');
  if(!name) return;
  pushUndo();
  const page = pg();
  // Calculer la bbox
  const xs = toGroup.map(b=>b.x), ys = toGroup.map(b=>b.y);
  const x2 = toGroup.map(b=>b.x+b.w), y2 = toGroup.map(b=>b.y+b.h);
  const bx = Math.min(...xs)-20, by = Math.min(...ys)-20;
  const bx2 = Math.max(...x2)+20, by2 = Math.max(...y2)+20;
  // Créer le bloc GROUP
  const gid = 'G'+Date.now();
  const grpBlock = {
    id:gid, type:'GROUP',
    x:bx, y:by,
    w:Math.max(120, bx2-bx), h:60,
    active:false,
    ports_in:[], ports_out:[],
    params:{ name, _port_ins:[], _port_outs:[] }
  };
  // Créer la page interne avec les blocs sélectionnés + des GROUP_IN/OUT pour les ports coupés
  const innerBlocks = toGroup.map(b=>({...b, params:{...b.params}}));
  // Fils internes (entre blocs sélectionnés)
  const selectedIds = new Set(toGroup.map(b=>b.id));
  const innerWires = page.wires.filter(w=>selectedIds.has(w.src.bid)&&selectedIds.has(w.dst.bid))
    .map(w=>({...w,src:{...w.src},dst:{...w.dst}}));
  // Fils coupés → créer GROUP_IN / GROUP_OUT
  let portIdx = 0;
  const cutWires = [];
  page.wires.forEach(w=>{
    const srcIn = selectedIds.has(w.src.bid);
    const dstIn = selectedIds.has(w.dst.bid);
    if(srcIn && !dstIn){
      // Signal sort du groupe → GROUP_OUT interne
      const label = 'Q'+(++portIdx);
      const outBlock = {id:'GOUT_'+gid+'_'+portIdx, type:'GROUP_OUT', x:bx2-bx-80, y:by+(portIdx*40),
        w:80,h:44, active:false, ports_in:[], ports_out:[], params:{label}};
      updPorts(outBlock);
      innerBlocks.push(outBlock);
      innerWires.push({id:'gw_o'+portIdx, src:{bid:w.src.bid,port:w.src.port}, dst:{bid:outBlock.id,port:'IN'},
        _src:innerBlocks.find(b=>b.id===w.src.bid), _dst:outBlock});
      cutWires.push({type:'out', label, wire:w, portBlock:outBlock});
    }
    if(!srcIn && dstIn){
      // Signal entre dans le groupe → GROUP_IN interne
      const label = 'IN'+(++portIdx);
      const inBlock = {id:'GIN_'+gid+'_'+portIdx, type:'GROUP_IN', x:20, y:by+(portIdx*40),
        w:80,h:44, active:false, ports_in:[], ports_out:[], params:{label}};
      updPorts(inBlock);
      innerBlocks.push(inBlock);
      innerWires.push({id:'gw_i'+portIdx, src:{bid:inBlock.id,port:'SIG'}, dst:{bid:w.dst.bid,port:w.dst.port},
        _src:inBlock, _dst:innerBlocks.find(b=>b.id===w.dst.bid)});
      cutWires.push({type:'in', label, wire:w, portBlock:inBlock});
    }
  });
  grpBlock.params._inner_blocks = JSON.stringify({
    blocks: innerBlocks.map(b=>({...b,params:{...b.params}})),
    wires:  innerWires.map(w=>({...w,src:{...w.src},dst:{...w.dst}}))
  });
  grpBlock.params._port_ins  = cutWires.filter(c=>c.type==='in').map(c=>c.label);
  grpBlock.params._port_outs = cutWires.filter(c=>c.type==='out').map(c=>c.label);
  updPorts(grpBlock);
  // Supprimer les blocs groupés et leurs fils de la page courante
  toGroup.forEach(b=>{ delBlock(b); });
  // Ajouter le bloc GROUP
  page.blocks.push(grpBlock);
  // Reconnexion externe
  cutWires.forEach(c=>{
    if(c.type==='in'){
      page.wires.push({id:'gw_ext_'+Math.random().toString(36).slice(2),
        src:{bid:c.wire.src.bid,port:c.wire.src.port},
        dst:{bid:gid,port:c.label},
        _src:page.blocks.find(b=>b.id===c.wire.src.bid),
        _dst:grpBlock});
    } else {
      page.wires.push({id:'gw_ext_'+Math.random().toString(36).slice(2),
        src:{bid:gid,port:c.label},
        dst:{bid:c.wire.dst.bid,port:c.wire.dst.port},
        _src:grpBlock,
        _dst:page.blocks.find(b=>b.id===c.wire.dst.bid)});
    }
  });
  multiSel.clear(); selB=grpBlock; selW=null;
  notifyChange(); render();
}

function ungroupSelected(){
  if(!selB || selB.type !== 'GROUP'){ alert('Sélectionner un bloc GROUP'); return; }
  pushUndo();
  const page = pg();
  const grpBlock = selB;
  if(!grpBlock.params._inner_blocks) return;
  try{
    const saved = JSON.parse(grpBlock.params._inner_blocks);

    // ── 1. Blocs internes (sans les ports GROUP_IN / GROUP_OUT) ──────────
    const innerBlocks = saved.blocks.filter(b=>b.type!=='GROUP_IN'&&b.type!=='GROUP_OUT');

    // ── 2. Fils internes (entre blocs non-GROUP_IN / non-GROUP_OUT) ──────
    const innerWires = saved.wires.filter(w=>{
      const sb = saved.blocks.find(b=>b.id===w.src.bid);
      const db = saved.blocks.find(b=>b.id===w.dst.bid);
      return sb&&db&&sb.type!=='GROUP_IN'&&db.type!=='GROUP_OUT';
    });

    // ── 3. Construire les tables de reconnexion ───────────────────────────
    // Pour chaque GROUP_IN interne (label = port externe entrant) :
    //   trouver le fil interne qui part de ce GROUP_IN.SIG vers un bloc réel
    //   → on pourra relier le fil externe directement vers ce bloc réel
    const ginMap = {}; // label → {bid, port} (destination réelle dans le groupe)
    saved.blocks.filter(b=>b.type==='GROUP_IN').forEach(gin=>{
      const label = gin.params.label || gin.id;
      // fil interne : src=gin.id / port='SIG'  →  dst=bloc réel / port=X
      const iw = saved.wires.find(w=>w.src.bid===gin.id);
      if(iw) ginMap[label] = {bid: iw.dst.bid, port: iw.dst.port};
    });

    // Pour chaque GROUP_OUT interne (label = port externe sortant) :
    //   trouver le fil interne qui arrive sur ce GROUP_OUT.IN depuis un bloc réel
    //   → on pourra relier le fil externe directement depuis ce bloc réel
    const goutMap = {}; // label → {bid, port} (source réelle dans le groupe)
    saved.blocks.filter(b=>b.type==='GROUP_OUT').forEach(gout=>{
      const label = gout.params.label || gout.id;
      // fil interne : src=bloc réel / port=X  →  dst=gout.id / port='IN'
      const iw = saved.wires.find(w=>w.dst.bid===gout.id);
      if(iw) goutMap[label] = {bid: iw.src.bid, port: iw.src.port};
    });

    // ── 4. Ajouter les blocs internes à la page ──────────────────────────
    innerBlocks.forEach(bd=>{
      const b = Object.assign({}, bd, {params:{...bd.params}});
      updPorts(b);
      page.blocks.push(b);
    });

    // ── 5. Restaurer les fils internes ───────────────────────────────────
    innerWires.forEach(wd=>{
      const sb = page.blocks.find(b=>b.id===wd.src.bid);
      const db = page.blocks.find(b=>b.id===wd.dst.bid);
      if(sb&&db) page.wires.push({...wd, src:{...wd.src}, dst:{...wd.dst}, _src:sb, _dst:db});
    });

    // ── 6. Reconnexion des fils externes ────────────────────────────────
    // Récupérer les fils de la page pointant vers / depuis le bloc GROUP
    const extWires = page.wires.filter(w=>w.src.bid===grpBlock.id || w.dst.bid===grpBlock.id);

    extWires.forEach(ew=>{
      if(ew.dst.bid === grpBlock.id){
        // Fil externe → GROUP (port entrant du groupe)
        // Relier directement vers le bloc interne qui recevait ce signal
        const portLabel = ew.dst.port;
        const innerDst  = ginMap[portLabel];
        if(innerDst){
          const sb = page.blocks.find(b=>b.id===ew.src.bid);
          const db = page.blocks.find(b=>b.id===innerDst.bid);
          if(sb&&db){
            page.wires.push({
              id: 'ug_'+Math.random().toString(36).slice(2),
              src:{bid:sb.id, port:ew.src.port},
              dst:{bid:db.id, port:innerDst.port},
              _src:sb, _dst:db
            });
          }
        }
      } else if(ew.src.bid === grpBlock.id){
        // Fil GROUP → externe (port sortant du groupe)
        // Relier directement depuis le bloc interne qui produisait ce signal
        const portLabel = ew.src.port;
        const innerSrc  = goutMap[portLabel];
        if(innerSrc){
          const sb = page.blocks.find(b=>b.id===innerSrc.bid);
          const db = page.blocks.find(b=>b.id===ew.dst.bid);
          if(sb&&db){
            page.wires.push({
              id: 'ug_'+Math.random().toString(36).slice(2),
              src:{bid:sb.id, port:innerSrc.port},
              dst:{bid:db.id, port:ew.dst.port},
              _src:sb, _dst:db
            });
          }
        }
      }
    });

    // ── 7. Supprimer le bloc GROUP (et ses fils externes devenus obsolètes)
    multiSel.delete(grpBlock);
    page.blocks = page.blocks.filter(b=>b!==grpBlock);
    page.wires  = page.wires.filter(w=>w.src.bid!==grpBlock.id && w.dst.bid!==grpBlock.id);
    selB = null;
    showEmptyProps();
    notifyChange(); render();
  }catch(e){ console.error('Ungroup error',e); }
}

// ════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE DE GROUPES
// ════════════════════════════════════════════════════════════
let _groupLibrary = {};
function _saveLibrary(){
  const json = JSON.stringify(_groupLibrary);
  if(window.pybridge && window.pybridge.save_group_library){
    try{ window.pybridge.save_group_library(json); }catch(e){}
  }
  try{ localStorage.setItem('rpi_plc_group_lib', json); }catch(e){}
}
function _loadLibrary(){
  // Priorité 1 : bibliothèque pré-injectée dans le HTML au chargement (pas de limite taille)
  if(window._preloadedGroupLib && typeof window._preloadedGroupLib === 'object'
     && Object.keys(window._preloadedGroupLib).length > 0){
    _groupLibrary = window._preloadedGroupLib;
    console.log('[LIB] groupes pré-injectés:', Object.keys(_groupLibrary).join(', '));
    buildLibraryPanel();
    return;
  }
  // Priorité 2 : via pybridge (pour rechargements dynamiques, max ~60KB)
  if(window.pybridge && window.pybridge.load_group_library){
    try{
      window.pybridge.load_group_library(function(r){
        if(!r || r==='{}'|| r==='null'){ buildLibraryPanel(); return; }
        // Gérer le cas fichier /tmp (pour bibliothèques > 60KB)
        if(r.startsWith('__FILE__:')){
          const path = r.substring(9);
          fetch('file://' + path)
            .then(res=>res.json())
            .then(parsed=>{ _groupLibrary=parsed; buildLibraryPanel(); })
            .catch(()=>buildLibraryPanel());
          return;
        }
        try{
          const parsed = JSON.parse(r);
          _groupLibrary = parsed;
          console.log('[LIB] groupes chargés via pybridge:', Object.keys(_groupLibrary).join(', '));
          buildLibraryPanel();
        }catch(e){ console.error('[LIB] parse error:', e.message); buildLibraryPanel(); }
      });
    }catch(e){ buildLibraryPanel(); }
    return;
  }
  buildLibraryPanel();
}
function _waitAndLoadLibrary(attempt){
  if(window.pybridge && window.pybridge.load_group_library){ _loadLibrary(); return; }
  if((attempt||0) < 10) setTimeout(()=>_waitAndLoadLibrary((attempt||0)+1), 500);
}
setTimeout(_waitAndLoadLibrary, 500);

function exportGroupToLibrary(grpBlock){
  if(!grpBlock||grpBlock.type!=='GROUP'){alert('Sélectionner un bloc GROUP');return;}
  const name=prompt('Nom dans la bibliothèque :',grpBlock.params.name||'Groupe');
  if(!name)return;
  _groupLibrary[name]={name,ports_in:JSON.parse(JSON.stringify(grpBlock.params._port_ins||[])),
    ports_outs:JSON.parse(JSON.stringify(grpBlock.params._port_outs||[])),
    _inner_blocks:grpBlock.params._inner_blocks||'{}',created:new Date().toISOString().slice(0,16)};
  console.log('[LIB] export groupe:', name, JSON.stringify(_groupLibrary).substring(0,100));
  _saveLibrary(); buildLibraryPanel(); _showFbdToast('"'+name+'" ajouté à la bibliothèque');
}

function importGroupFromLibrary(name){
  const tpl=_groupLibrary[name]; if(!tpl)return;
  pushUndo();
  const p=pg(); const cx=tw(cvs.width/2,cvs.height/2); const gid='G'+Date.now();
  const grpBlock={id:gid,type:'GROUP',x:cx.x-80,y:cx.y-30,
    w:Math.max(120,name.length*8+40),h:60,active:false,ports_in:[],ports_out:[],
    params:{name:tpl.name,_port_ins:JSON.parse(JSON.stringify(tpl.ports_in||[])),
            _port_outs:JSON.parse(JSON.stringify(tpl.ports_outs||tpl.ports_out||[])),
            _inner_blocks:tpl._inner_blocks}};
  updPorts(grpBlock); p.blocks.push(grpBlock);
  selB=grpBlock; multiSel.clear(); notifyChange(); render();
  _showFbdToast('"'+name+'" importé depuis la bibliothèque');
}

function deleteFromLibrary(name){
  // confirm() peut être bloqué dans QtWebEngine — supprimer directement avec undo via toast
  delete _groupLibrary[name];
  _saveLibrary();
  buildLibraryPanel();
  _showFbdToast('Groupe "' + name + '" supprimé de la bibliothèque');
}

function exportLibraryJSON(){
  const blob=new Blob([JSON.stringify(_groupLibrary,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='rpi_plc_library.json'; a.click();
}

function importLibraryJSON(){
  const input=document.createElement('input'); input.type='file'; input.accept='.json';
  input.onchange=e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{ const data=JSON.parse(ev.target.result); Object.assign(_groupLibrary,data);
        _saveLibrary(); buildLibraryPanel();
        _showFbdToast('Bibliothèque importée ('+Object.keys(data).length+' groupes)');
      }catch(ex){alert('Fichier JSON invalide');}
    };
    reader.readAsText(file);
  };
  input.click();
}

function _showFbdToast(msg){
  let t=document.getElementById('_fbd_toast');
  if(!t){t=document.createElement('div');t.id='_fbd_toast';
    t.style.cssText='position:absolute;bottom:40px;left:50%;transform:translateX(-50%);'+
    'background:#1a2f45;border:1px solid #58a6ff;border-radius:6px;padding:6px 16px;'+
    'font-size:11px;color:#e6edf3;font-family:monospace;z-index:999;pointer-events:none;opacity:0;transition:opacity .3s;';
    document.body.appendChild(t);}
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.style.opacity='0',2500);
}

function buildLibraryPanel(){
  const panel=document.getElementById('_lib_panel'); if(!panel)return;
  const keys=Object.keys(_groupLibrary);
  if(!keys.length){panel.innerHTML='<div style="color:#484f58;font-size:11px;padding:4px 8px">Vide \u2014 clic droit sur un groupe pour l\'ajouter</div>';return;}
  panel.innerHTML=keys.map(n=>{
    const tpl=_groupLibrary[n];
    const nIn=(tpl.ports_in||[]).length, nOut=(tpl.ports_outs||tpl.ports_out||[]).length;
    return `<div class="pal-item" draggable="true" style="cursor:grab"
      ondragstart="event.dataTransfer.setData('lib-group',${JSON.stringify(n)});event.dataTransfer.effectAllowed='copy'">
      <span class="pal-badge" style="color:#bc8cff;border-color:#bc8cff50">GRP</span>
      <span class="pal-desc" style="flex:1;font-size:10px">${n}<br>
        <span style="color:#484f58;font-size:9px">${nIn}E · ${nOut}S</span>
      </span>
      <span class="lib-del-btn" data-name="${n}" title="Supprimer"
        style="color:#f85149;cursor:pointer;font-size:12px;padding:0 4px;flex-shrink:0">✕</span>
    </div>`;
  }).join('');
  panel.querySelectorAll('.pal-item').forEach((row,i)=>{
    const n=keys[i];
    // Clic sur ✕ → supprimer ; clic ailleurs → importer
    row.querySelector('.lib-del-btn').addEventListener('click',e=>{
      e.stopPropagation();
      deleteFromLibrary(n);
    });
    row.addEventListener('click',e=>{
      if(e.target.classList.contains('lib-del-btn')) return;
      importGroupFromLibrary(n);
    });
  });
}

// GPIO dynamiques — mis à jour via fbdAPI.setGpioConfig() depuis le studio
let GPIO_IN   = [14, 15, 18, 23, 24, 25, 8, 7];  // ordre TOR1→TOR8
let GPIO_OUT  = [5, 6, 11, 13, 9, 19, 10, 26, 22, 21, 27, 20, 17, 16, 4, 12];  // ordre K1→K16 (carte interleaved)
let GPIO_NAMES = {"4":"Sortie K15","5":"Sortie K1","6":"Sortie K2","7":"Entr\u00e9e TOR 8","8":"Entr\u00e9e TOR 7","9":"Sortie K5","10":"Sortie K7","11":"Sortie K3","12":"Sortie K16","13":"Sortie K4","14":"Entr\u00e9e TOR 1","15":"Entr\u00e9e TOR 2","16":"Sortie K14","17":"Sortie K13","18":"Entr\u00e9e TOR 3","19":"Sortie K6","20":"Sortie K12","21":"Sortie K10","22":"Sortie K9","23":"Entr\u00e9e TOR 4","24":"Entr\u00e9e TOR 5","25":"Entr\u00e9e TOR 6","26":"Sortie K8","27":"Sortie K11"};  // initialisé depuis config.json
const MEMS      = Array.from({length:16},(_,i)=>`M${i}`);
const ANA_REFS  = ['PT0','PT1','PT2','PT3','ANA0','ANA1','ANA2','ANA3'];
const REG_REFS  = Array.from({length:16},(_,i)=>`RF${i}`);
const PT_TYPES  = [{v:'pt100',l:'PT100 (100Ω)'},{v:'pt1000',l:'PT1000 (1kΩ)'}];
const ADS_CH    = [{v:0,l:'CH0'},{v:1,l:'CH1'},{v:2,l:'CH2'},{v:3,l:'CH3'}];
const SPI_CH    = [{v:0,l:'SPI CE0'},{v:1,l:'SPI CE1'},{v:2,l:'SPI CE2'},{v:3,l:'SPI CE3'}];

// ════════════════════════════════════════════════════════════
// ÉTAT
// ════════════════════════════════════════════════════════════
let pages   = [];
let cur     = 0;   // index page courante
let idCtr   = 1;
const pgVP  = {};  // pageId → {x,y,scale}
let vp      = {x:40,y:40,scale:1};

let selB=null, selW=null, multiSel=new Set();
let drag=null,_rszB=null,_rszOrig=null, rubberStart=null, rubberRect=null;
let dragOX=0,dragOY=0,panSX=0,panSY=0;
let wireFrom=null;
let lastMX=0,lastMY=0;

// ── UNDO/REDO ──────────────────────────────────────────────────
const UNDO_MAX = 40;
let _undoStack = [];   // chaque entrée = snapshot JSON de pages
let _redoStack = [];
let _undoFrozen  = false;  // évite d'empiler pendant undo/redo lui-même
let _undoEnabled = false;  // activé seulement après 1er loadDiagram ou action utilisateur

function _snapshot(){
  return JSON.stringify(pages.filter(p=>!p.id.startsWith('__grp_')).map(p=>({
    id:p.id, name:p.name,
    blocks:p.blocks.map(b=>({...b,params:{...b.params}})),
    wires:p.wires.map(w=>({...w,src:{...w.src},dst:{...w.dst}}))
  })));
}

function pushUndo(){
  if(_undoFrozen || !_undoEnabled) return;
  _undoStack.push({snap:_snapshot(), cur});
  if(_undoStack.length > UNDO_MAX) _undoStack.shift();
  _redoStack = [];
  _updateUndoUI();
}

function _restoreSnap(entry){
  _undoFrozen = true;
  const restored = JSON.parse(entry.snap);
  pages = restored.map(pd=>{
    const p = {id:pd.id, name:pd.name, blocks:[], wires:[]};
    pd.blocks.forEach(bd=>{
      const b={id:bd.id,type:bd.type,x:bd.x,y:bd.y,w:BW,h:computeH(bd.type),
               params:{...defParams(bd.type),...bd.params},ports_in:[],ports_out:[],active:false};
      updPorts(b);  // recalcule h pour GROUP et CARITHM
      p.blocks.push(b);
      const n=parseInt(bd.id.replace(/\D/g,''));if(n>=idCtr)idCtr=n+1;
    });
    pd.wires.forEach(wd=>{
      const w={id:wd.id,src:{...wd.src},dst:{...wd.dst}};
      const sb=p.blocks.find(b=>b.id===w.src.bid);
      const db=p.blocks.find(b=>b.id===w.dst.bid);
      if(sb&&db){
        const sp=sb.ports_out.find(pp=>pp.name===w.src.port);
        const dp=db.ports_in.find(pp=>pp.name===w.dst.port);
        if(sp&&dp){w.sx=sp.x;w.sy=sp.y;w.dx=dp.x;w.dy=dp.y;}
      }
      p.wires.push(w);
    });
    return p;
  });
  cur = Math.min(entry.cur, pages.length-1);
  selB=null; selW=null;
  updateNav(); drawGrid(); render(); showEmptyProps();
  notifyChange();
  _undoFrozen = false;
  _updateUndoUI();
}

function undo(){
  if(!_undoStack.length) return;
  _redoStack.push({snap:_snapshot(), cur});
  _restoreSnap(_undoStack.pop());
}

function redo(){
  if(!_redoStack.length) return;
  _undoStack.push({snap:_snapshot(), cur});
  _restoreSnap(_redoStack.pop());
}

function _updateUndoUI(){
  const ub=document.getElementById('btn-undo');
  const rb=document.getElementById('btn-redo');
  if(ub){ ub.classList.toggle('active', _undoStack.length>0);
          ub.title=_undoStack.length ? `Annuler (Ctrl+Z) — ${_undoStack.length} action(s)` : 'Rien à annuler'; }
  if(rb){ rb.classList.toggle('active', _redoStack.length>0);
          rb.title=_redoStack.length ? `Rétablir (Ctrl+Y) — ${_redoStack.length} action(s)` : 'Rien à rétablir'; }
}

// ════════════════════════════════════════════════════════════
// CANVAS
// ════════════════════════════════════════════════════════════
const area  = document.getElementById('canvas-area');
const bgC   = document.getElementById('bg');
const cvs   = document.getElementById('main');
const g2    = bgC.getContext('2d');
const ctx   = cvs.getContext('2d');
const BW=120, HDR=24, PGAP=22, PTOP=8, PR=5;
let GRID=20, SNAP=true;

function resize(){
  const W=area.clientWidth,H=area.clientHeight;
  bgC.width=cvs.width=W; bgC.height=cvs.height=H;
  drawGrid(); render();
}
window.addEventListener('resize',resize);

function drawGrid(){
  g2.clearRect(0,0,bgC.width,bgC.height);
  g2.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--fbd-bg').trim()||'#0d1117'; g2.fillRect(0,0,bgC.width,bgC.height);
  const s=GRID*vp.scale; if(s<6)return;
  g2.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--fbd-grid').trim()||'#1c2128'; g2.lineWidth=.5;
  const ox=((vp.x%s)+s)%s, oy=((vp.y%s)+s)%s;
  for(let x=ox;x<bgC.width;x+=s){g2.beginPath();g2.moveTo(x,0);g2.lineTo(x,bgC.height);g2.stroke();}
  for(let y=oy;y<bgC.height;y+=s){g2.beginPath();g2.moveTo(0,y);g2.lineTo(bgC.width,y);g2.stroke();}
}
const tw=(cx,cy)=>({x:(cx-vp.x)/vp.scale,y:(cy-vp.y)/vp.scale});
const sn=v=>SNAP?Math.round(v/GRID)*GRID:Math.round(v);
const pg=()=>pages[cur];

// ════════════════════════════════════════════════════════════
// NAVIGATION PAGES
// ════════════════════════════════════════════════════════════
function addPage(name){
  const id=`P${idCtr++}`;
  pages.push({id,name:name||`Page ${pages.length+1}`,blocks:[],wires:[]});
  pgVP[id]={x:40,y:40,scale:1};
  goPage(pages.length-1);
}

function goPage(idx){
  if(idx<0||idx>=pages.length)return;
  if(pages[cur]) pgVP[pages[cur].id]={...vp};
  cur=idx;
  const sv=pgVP[pages[cur].id];
  vp.x=sv.x;vp.y=sv.y;vp.scale=sv.scale;
  selB=null;selW=null;showEmptyProps();
  updateNav(); drawGrid(); render();
}

function updateNav(){
  const total=pages.length;
  const p=pages[cur];
  document.getElementById('nav-prev').className='nav-arrow'+(cur===0?' disabled':'');
  document.getElementById('nav-next').className='nav-arrow'+(cur===total-1?' disabled':'');
  document.getElementById('nav-page-name').textContent=`${cur+1} / ${total}  —  ${p?p.name:''}`;

  // Points de navigation
  const dots=document.getElementById('nav-page-dots');
  dots.innerHTML='';
  const maxDots=Math.min(total,12);
  const startDot=Math.max(0,Math.min(cur-5,total-maxDots));
  for(let i=startDot;i<startDot+maxDots;i++){
    const d=document.createElement('div');
    d.className='page-dot'+(i===cur?' active':'');
    d.title=pages[i]?pages[i].name:'';
    d.addEventListener('click',()=>goPage(i));
    dots.appendChild(d);
  }

  // Badge inter-pages
  if(p){
    const xp=p.blocks.filter(b=>b.type==='PAGE_IN'||b.type==='PAGE_OUT'||b.type==='CONN');
    document.getElementById('nav-crosspage-badge').style.display=xp.length?'block':'none';
  }
}

function deletePage(idx){
  if(pages.length<=1)return;
  pages.splice(idx,1);
  if(cur>=pages.length)cur=pages.length-1;
  pushUndo(); updateNav(); goPage(cur); notifyChange();
}

function renameCurrentPage(){
  const p=pages[cur]; if(!p)return;
  const name=prompt('Nom de la page :',p.name);
  if(name&&name.trim()){p.name=name.trim();updateNav();notifyChange();}
}

document.getElementById('nav-prev').addEventListener('click',()=>{if(cur>0)goPage(cur-1);});
document.getElementById('nav-next').addEventListener('click',()=>{if(cur<pages.length-1)goPage(cur+1);});
document.getElementById('nav-add').addEventListener('click',()=>{addPage();notifyChange();});
document.getElementById('nav-del').addEventListener('click',()=>deletePage(cur));
document.getElementById('nav-page-name').addEventListener('dblclick',renameCurrentPage);

// ════════════════════════════════════════════════════════════
// PALETTE
// ════════════════════════════════════════════════════════════
function buildPalette(){
  const pal=document.getElementById('palette');
  if(!pal)return;  // garde-fou si DOM pas encore prêt
  pal.innerHTML='';
  const groups={};
  Object.entries(DEFS).forEach(([t,d])=>{
    if(!groups[d.cat])groups[d.cat]=[];
    groups[d.cat].push([t,d]);
  });
  Object.entries(groups).forEach(([cat,items])=>{
    const h=document.createElement('div');
    h.className='pal-hdr';h.textContent=cat;pal.appendChild(h);
    items.forEach(([t,d])=>{
      const row=document.createElement('div');
      row.className='pal-item';row.draggable=true;
      row.title=`${t} — ${d.desc}\n↓ ${d.ins.join(', ')||'—'}  ↑ ${d.outs.join(', ')||'—'}`;
      row.innerHTML=`<span class="pal-badge" style="color:${d.bdg};border-color:${d.bdg}50">${t}</span><span class="pal-desc">${d.desc}</span>`;
      row.addEventListener('dragstart',e=>{e.dataTransfer.setData('block-type',t);e.dataTransfer.effectAllowed='copy';});
      row.addEventListener('click',()=>{
        const mw=tw(cvs.width/2,cvs.height/2);
        addBlock(t,mw.x-BW/2,mw.y-computeH(t)/2);
      });
      pal.appendChild(row);
    });
  });
  // Section bibliothèque en bas de palette
  const libSep = document.createElement('div');
  libSep.style.cssText='border-top:1px solid #30363d;padding-top:4px;margin-top:4px;';
  libSep.innerHTML=`
    <div class="pal-hdr" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
      <span>Bibliothèque</span>
      <span style="display:flex;gap:6px;">
        <span onclick="importLibraryJSON()" title="Importer .json" style="cursor:pointer;color:#58a6ff;font-size:13px">⬆</span>
        <span onclick="exportLibraryJSON()" title="Exporter .json" style="cursor:pointer;color:#58a6ff;font-size:13px">⬇</span>
      </span>
    </div>
    <div id="_lib_panel"></div>`;
  pal.appendChild(libSep);
}
cvs.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
cvs.addEventListener('drop',e=>{
  e.preventDefault();
  const libName=e.dataTransfer.getData('lib-group');
  if(libName){
    const r=cvs.getBoundingClientRect(); const w=tw(e.clientX-r.left,e.clientY-r.top);
    const tpl=_groupLibrary[libName]; if(!tpl)return;
    pushUndo(); const p=pg(); const gid='G'+Date.now();
    const grpBlock={id:gid,type:'GROUP',x:w.x-80,y:w.y-30,
      w:Math.max(120,libName.length*8+40),h:60,active:false,ports_in:[],ports_out:[],
      params:{name:tpl.name,_port_ins:JSON.parse(JSON.stringify(tpl.ports_in||[])),
              _port_outs:JSON.parse(JSON.stringify(tpl.ports_outs||tpl.ports_out||[])),
              _inner_blocks:tpl._inner_blocks}};
    updPorts(grpBlock); p.blocks.push(grpBlock);
    selB=grpBlock; multiSel.clear(); notifyChange(); render(); return;
  }
  const t=e.dataTransfer.getData('block-type');if(!t)return;
  const r=cvs.getBoundingClientRect();
  const w=tw(e.clientX-r.left,e.clientY-r.top);
  addBlock(t,w.x-BW/2,w.y-computeH(t)/2);
});

// ════════════════════════════════════════════════════════════
// BLOCS
// ════════════════════════════════════════════════════════════
function computeH(t){
  const d=DEFS[t]||DEFS.AND;
  return HDR+PTOP+Math.max(d.ins.length,d.outs.length,1)*PGAP+8;
}

function addBlock(t,wx,wy){
  if(t==='GROUP'){
    const name=prompt('Nom du groupe :','Nouveau groupe'); if(!name)return null;
    pushUndo(); const p=pg(); const gid='G'+Date.now();
    const grpBlock={id:gid,type:'GROUP',x:sn(wx)||100,y:sn(wy)||100,w:Math.max(140,name.length*9),h:60,
      active:false,ports_in:[],ports_out:[],params:{name,_port_ins:[],_port_outs:[]}};
    updPorts(grpBlock); p.blocks.push(grpBlock);
    selB=grpBlock; multiSel.clear(); notifyChange(); render(); return grpBlock;
  }
  pushUndo();
  const bid=`B${idCtr++}`;
  const b={id:bid,type:t,x:sn(wx),y:sn(wy),w:BW,h:computeH(t),
           params:defParams(t),ports_in:[],ports_out:[],active:false};
  updPorts(b);
  pg().blocks.push(b);
  selB=b;selW=null;showBlockProps(b);
  notifyChange();render();return b;
}

function defParams(t){
  if(t==='INPUT')   return{pin:14,name:'TOR1'};
  if(t==='OUTPUT')  return{pin:5,name:'K1'};
  if(t==='CONST')   return{value:0};
  if(t==='MEM')     return{bit:'M0'};
  if(t==='PAGE_IN') return{signal:'SIG1'};
  if(t==='PAGE_OUT')return{signal:'SIG1'};
  if(t==='CONN')    return{num:1,label:'C1'};
  if(['TON','TOF','TP'].includes(t))return{preset_ms:1000};
  if(['CTU','CTD','CTUD'].includes(t))return{preset:10};
  if(t==='PT_IN')   return{analog_ref:'PT0',pt_type:'pt100',spi_ch:0,reg_out:'RF0',wires:3,name:'Sonde PT100'};
  if(t==='ANA_IN')  return{analog_ref:'ANA0',ads_ch:0,reg_out:'RF1',name:'Entrée analogique'};
  if(t==='COMPARE_F')return{reg_ref:'RF0',threshold:80.0,hysteresis:1.0,op:'gt'};
  if(t==='SCALE')   return{reg_ref:'RF1',reg_out:'RF2',in_lo:0.0,in_hi:5.0,out_lo:0.0,out_hi:100.0};
  if(t==='PID')     return{pv_ref:'RF0',setpoint:50.0,kp:1.0,ki:0.1,kd:0.0,out_min:0.0,out_max:100.0,reg_out:'RF3'};
  // Nouveaux blocs
  if(t==='SENSOR')  return{ref:'ANA0',name:'Capteur',correction:0.0};
  if(t==='ADD')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='SUB')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='MUL')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='DIV')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='MUX')     return{idx_ref:'RF0',n_in:4,in0:'RF0',in1:'RF1',in2:'RF2',in3:'RF3',reg_out:'RF4'};
  if(t==='COMPH')   return{ref:'RF0',high:80.0,hyst:0.5,reg_out:'M0'};
  if(t==='COMPL')   return{ref:'RF0',low:10.0,hyst:0.5,reg_out:'M1'};
  if(t==='ABS')     return{reg_in:'RF0',reg_out:'RF1'};
  if(t==='MIN')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='MAX')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='MOD')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='SQRT')    return{reg_in:'RF0',reg_out:'RF1'};
  if(t==='POW')     return{reg_a:'RF0',reg_b:'RF1',reg_out:'RF2'};
  if(t==='CLAMP'||t==='CLAMP_A') return{reg_in:'RF0',reg_out:'RF1',lo:0.0,hi:100.0};
  if(t==='SEL')     return{in0:'RF0',in1:'RF1',reg_out:'RF2'};
  if(t==='FILT1')   return{reg_in:'RF0',reg_out:'RF1',tc_s:10.0};
  if(t==='AVG')     return{reg_in:'RF0',reg_out:'RF1',n:10};
  if(t==='INTEG')   return{reg_in:'RF0',reg_out:'RF1',ki:1.0,lo:-1e9,hi:1e9};
  if(t==='DERIV')   return{reg_in:'RF0',reg_out:'RF1',kd:1.0};
  if(t==='DEADB')   return{reg_in:'RF0',reg_out:'RF1',dead:1.0};
  if(t==='RAMP')    return{reg_sp:'RF0',reg_out:'RF1',rate:1.0};
  if(t==='HYST')    return{reg_in:'RF0',sp:50.0,band:2.0};
  if(t==='XOR')     return{};
  if(t==='INV')     return{};
  if(t==='WAIT')    return{delay_s:5,name:'Attente'};
  if(t==='WAITH')   return{delay_s:5,name:'Tempo désact'};
  if(t==='PULSE')   return{duration_s:3,name:'Impulsion'};
  if(t==='BACKUP')  return{varname:'backup0',default:0.0,bktype:'float'};
  if(t==='AV')      return{varname:'av0',default:0.0};
  if(t==='DV')      return{varname:'dv0',default:false};
  if(t==='STOAV')   return{varname:'av0'};
  if(t==='STOAP')   return{varname:'timer0.TimerTime'};
  if(t==='LOCALTIME')return{};
  if(t==='SR_R')    return{bit:'M0'};
  if(t==='SR_S')    return{bit:'M1'};
  if(t==='PYBLOCK') return{name:'PyBlock',
    code:'# A1..A4 float, d1..d4 bool\n# OA1..OA2 float, od1..od3 bool\n# dt, cycle, state\n',
    n_a:2,n_d:1,n_i:0,n_oa:1,n_od:1,n_oi:0};
  if(t==='CARITHM') return{
    code:'// Variables :\n// A1..A8 : entrées analogiques\n// d1..d7 : entrées booléennes\n// I1,I2  : entrées entières\n// OA1..OA8 : sorties analogiques\n// od1..od8 : sorties booléennes\n// OI1 : sortie entière\n\nif (A1 > A2) od1 = 1;\nelse od1 = 0;',
    n_a:2, n_d:1, n_i:0, n_oa:0, n_od:1, n_oi:0, name:'CArithm'};
  // ── Blocs Métier ─────────────────────────────────────────────────────────
  if(t==='PLANCHER')  return{
    name:'Plancher',
    pv_ref_amb:'RF0',       // sonde ambiante (régulation principale)
    pv_ref_depart:'',       // sonde départ eau chaude (optionnelle)
    pv_ref_retour:'',       // sonde retour plancher (optionnelle)
    sp:20.0,                // consigne ambiante °C
    max_depart:45.0,        // limite max départ eau (sécurité plancher)
    min_delta:3.0,          // delta min départ-retour pour détecter circulation
    kp:2.0, ki:0.1, kd:0.5, dead_band:0.5,
    out_vanne:'k1', out_pompe:'k2', reg_out:'RF8',
    reg_depart:'RF9',       // registre température départ (lecture)
    reg_retour:'RF10',      // registre température retour (lecture)
    reg_delta:'RF11',       // registre delta départ-retour (diagnostic)
    min_temp:5.0, max_temp:35.0};
  if(t==='CHAUDIERE') return{
    name:'Chaudière', pv_ref_retour:'RF1', pv_ref_depart:'RF2', sp:65.0,
    hysteresis:3.0, min_on_s:60, min_off_s:30, max_depart:90.0,
    out_brulee:'k3', out_pompe:'k4'};
  if(t==='SOLAR') return{
    name:'Solaire',
    pv_ref_capteur:'RF0',     // sonde capteur solaire
    pv_ref_ecs:'RF3',          // sonde ballon ECS
    pv_ref_chauf:'',           // sonde ballon chauffage (optionnel)
    delta_on:8.0,              // ΔT capteur−ballon pour démarrer pompe (°C)
    delta_off:3.0,             // ΔT capteur−ballon pour arrêter pompe (°C)
    sp_ecs:60.0,               // consigne ECS (prioritaire)
    sp_chauf:50.0,             // consigne chauffage (secondaire)
    max_capteur:120.0,         // sécurité surchauffe capteur (stagnation)
    min_capteur:5.0,           // température déclenchement protection gel capteur (°C)
    antigel_mode:'off',        // 'off' | 'chaudiere' | 'ecs' — source eau chaude anti-gel
    antigel_temp_source:30.0,  // température mini source pour lancer la protection (°C)
    pump_mode:'on_off',        // 'on_off' ou 'analog_0_10'
    out_pompe:'k1',            // pompe solaire (TOR si on_off)
    out_pompe_av:'',           // variable AV 0-10V (si analog_0_10)
    pump_min_pct:10.0,         // vitesse mini pompe analogique (%)
    pump_delta_max:30.0,       // ΔT pour vitesse 100% (proportionnel)
    out_vanne_ecs:'k2',        // vanne directionnelle vers ECS
    out_vanne_chauf:'k3',      // vanne directionnelle vers chauffage
    reg_delta:'RF12',          // registre ΔT capteur−ballon (diagnostic)
    reg_rendement:'RF13',      // registre rendement (énergie captée)
    reg_vitesse_pompe:'RF14',  // registre vitesse pompe % (diagnostic)
  };
  if(t==='ZONE_CHAUF') return{
    name:'Zone', pv_ref:'RF0', sp:20.0, hysteresis:0.5,
    out_vanne:'k5', delay_open_s:120, delay_close_s:120};
  if(t==='ECS_BLOC')  return{
    name:'ECS', pv_ref_ecs:'RF3', pv_ref_prim:'RF4',
    sp_ecs:55.0, sp_antileg:65.0, antileg_day:0, antileg_hour:3,
    hysteresis:2.0, out_pompe:'k6'};

  if(t==='CONTACTOR')return{name:'K1',pin:5};
  if(t==='GROUP_IN') return{label:'IN1'};
  if(t==='GROUP_OUT')return{label:'Q1'};
  if(t==='VALVE3V')  return{name:'V3V',pin_inc:9,pin_dec:10};
  if(t==='RUNTIMCNT')return{name:'Compteur1',reg_starts:'',reg_total:'',reg_runtime:''};
  return{};
}

function updPorts(b){
  if(b.type==='GROUP'){
    // Ports propres au bloc, pas via DEFS partagé (évite corruption entre blocs)
    const ins  = b.params._port_ins  || [];
    const outs = b.params._port_outs || [];
    b.ports_in  = ins.map( (n,i)=>({name:n,x:b.x,    y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
    b.ports_out = outs.map((n,i)=>({name:n,x:b.x+b.w,y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
    const nPorts = Math.max(ins.length, outs.length, 1);
    b.h = Math.max(60, HDR + PTOP + nPorts*PGAP + 10);
    return;
  }
  if(b.type==='CARITHM'){ updPortsCarithm(b); return; }
  if(b.type==='PYBLOCK') { updPortsPyblock(b);  return; }
  const d=DEFS[b.type]||DEFS.AND;
  b.ports_in =d.ins.map((n,i) =>({name:n,x:b.x,    y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.ports_out=d.outs.map((n,i)=>({name:n,x:b.x+b.w,y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
}

function updPortsCarithm(b){
  const p=b.params;
  const na=parseInt(p.n_a)||2, nd=parseInt(p.n_d)||1, ni=parseInt(p.n_i)||0;
  const noa=parseInt(p.n_oa)||0, nod=parseInt(p.n_od)||1, noi=parseInt(p.n_oi)||0;
  const ins=[], outs=[];
  for(let i=1;i<=na;i++)  ins.push(`A${i}`);
  for(let i=1;i<=nd;i++)  ins.push(`d${i}`);
  for(let i=1;i<=ni;i++)  ins.push(`I${i}`);
  for(let i=1;i<=noa;i++) outs.push(`OA${i}`);
  for(let i=1;i<=nod;i++) outs.push(`od${i}`);
  for(let i=1;i<=noi;i++) outs.push(`OI${i}`);
  b.ports_in =ins.map( (n,i)=>({name:n,x:b.x,    y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.ports_out=outs.map((n,i)=>({name:n,x:b.x+b.w,y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.h=HDR+PTOP+Math.max(ins.length,outs.length,1)*PGAP+8;
}

function moveBlock(b,nx,ny){
  b.x=sn(nx);b.y=sn(ny);
  // Préserver h/w manuels pour CARITHM/PYBLOCK qui recalculent b.h dans updPorts
  const _prevH=b.h, _prevW=b.w;
  updPorts(b);
  const _defH=computeH(b.type);
  if(_prevH > _defH){ b.h=_prevH; _updPortsPos(b); }
  if(_prevW !== BW)  { b.w=_prevW; _updPortsPos(b); }
  pg().wires.forEach(w=>{if(w.src.bid===b.id||w.dst.bid===b.id)recalcW(w);});
}

function delBlock(b){
  multiSel.delete(b);
  pushUndo();
  const p=pg();
  p.blocks=p.blocks.filter(x=>x!==b);
  p.wires =p.wires.filter(w=>w.src.bid!==b.id&&w.dst.bid!==b.id);
  if(selB===b){selB=null;showEmptyProps();}
  notifyChange();render();
}

// ════════════════════════════════════════════════════════════
// FILS
// ════════════════════════════════════════════════════════════
function recalcW(w){
  const p=pg();
  const sb=p.blocks.find(b=>b.id===w.src.bid);
  const db=p.blocks.find(b=>b.id===w.dst.bid);
  if(!sb||!db)return;
  const sp=sb.ports_out.find(p=>p.name===w.src.port);
  const dp=db.ports_in.find(p=>p.name===w.dst.port);
  if(!sp||!dp)return;
  w.sx=sp.x;w.sy=sp.y;w.dx=dp.x;w.dy=dp.y;
}

function addWire(sBid,sPort,dBid,dPort){
  const p=pg();
  if(p.wires.some(w=>w.src.bid===sBid&&w.src.port===sPort&&w.dst.bid===dBid&&w.dst.port===dPort))return;
  pushUndo();
  const w={id:`W${idCtr++}`,src:{bid:sBid,port:sPort},dst:{bid:dBid,port:dPort}};
  recalcW(w);p.wires.push(w);
  notifyChange();render();
}

function delWire(w){
  pushUndo();
  pg().wires=pg().wires.filter(x=>x!==w);
  if(selW===w){selW=null;showEmptyProps();}
  notifyChange();render();
}

// ════════════════════════════════════════════════════════════
// RENDU
// ════════════════════════════════════════════════════════════
function render(){
  ctx.clearRect(0,0,cvs.width,cvs.height);
  if(!pg())return;
  ctx.save();ctx.translate(vp.x,vp.y);ctx.scale(vp.scale,vp.scale);
  pg().wires.forEach(w=>drawWire(w,w===selW));
  if(wireFrom){
    ctx.strokeStyle='#f0883e';ctx.lineWidth=2/vp.scale;
    ctx.setLineDash([5/vp.scale,4/vp.scale]);
    const mw=tw(lastMX,lastMY);
    ctx.beginPath();ctx.moveTo(wireFrom.wx,wireFrom.wy);
    bez(ctx,wireFrom.wx,wireFrom.wy,mw.x,mw.y);
    ctx.stroke();ctx.setLineDash([]);
  }
  pg().blocks.forEach(b=>drawBlock(b,b===selB||multiSel.has(b)));
  drawRubber();
  ctx.restore();
}

function bez(ctx,sx,sy,dx,dy){
  const cx=Math.max(Math.abs(dx-sx)*.5,30);
  ctx.bezierCurveTo(sx+cx,sy,dx-cx,dy,dx,dy);
}
function bezPt(sx,sy,dx,dy,t){
  const cx=Math.max(Math.abs(dx-sx)*.5,30);
  return{x:bp(sx,sx+cx,dx-cx,dx,t),y:bp(sy,sy,dy,dy,t)};
}
function bp(a,b,c,d,t){const m=1-t;return m*m*m*a+3*m*m*t*b+3*m*t*t*c+t*t*t*d;}

function drawWire(w,sel){
  if(!('sx'in w))recalcW(w);
  const sb=pg().blocks.find(b=>b.id===w.src.bid);
  const active=sb&&sb.active;
  ctx.strokeStyle=sel?'#f0883e':active?'#3fb950':'#58a6ff';
  ctx.lineWidth=(sel?2.5:1.5)/vp.scale;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(w.sx,w.sy);bez(ctx,w.sx,w.sy,w.dx,w.dy);ctx.stroke();
  [[w.sx,w.sy],[w.dx,w.dy]].forEach(([x,y])=>{
    ctx.beginPath();ctx.arc(x,y,3/vp.scale,0,Math.PI*2);
    ctx.fillStyle=ctx.strokeStyle;ctx.fill();
  });
}

function drawBlock(b,sel){
  const d=DEFS[b.type]||DEFS.AND;
  ctx.shadowColor='#000';ctx.shadowBlur=(sel?12:3)/vp.scale;ctx.shadowOffsetX=ctx.shadowOffsetY=2/vp.scale;
  ctx.fillStyle=b.active?'#0a1f0a':d.col;
  ctx.strokeStyle=sel?'#1f6feb':b.active?'#3fb950':'#30363d';
  ctx.lineWidth=(sel?2:1)/vp.scale;
  rr(b.x,b.y,b.w,b.h,6/vp.scale);ctx.fill();ctx.stroke();
  ctx.shadowBlur=0;

  // Header
  ctx.fillStyle=d.hdr;rrTop(b.x,b.y,b.w,HDR,6/vp.scale);ctx.fill();
  ctx.strokeStyle='#30363d';ctx.lineWidth=.5/vp.scale;
  ctx.beginPath();ctx.moveTo(b.x,b.y+HDR);ctx.lineTo(b.x+b.w,b.y+HDR);ctx.stroke();

  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#e6edf3';ctx.font=`bold ${11/vp.scale}px 'JetBrains Mono',monospace`;
  ctx.fillText(b.type,b.x+b.w/2,b.y+HDR/2);
  ctx.fillStyle='#484f58';ctx.font=`${8/vp.scale}px 'JetBrains Mono',monospace`;
  ctx.fillText(b.id,b.x+b.w/2,b.y+HDR-1.5/vp.scale);

  // Param central
  const pd=pdisp(b);
  if(pd){
    ctx.fillStyle='#d29922';ctx.font=`${10/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(pd,b.x+b.w/2,b.y+b.h/2+HDR/4);
  }

  // Ports entrée
  b.ports_in.forEach(p=>{
    drawPort(p.x,p.y,false,p._h);
    ctx.fillStyle='#8b949e';ctx.font=`${9/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(p.name,p.x+PR/vp.scale+3/vp.scale,p.y);
  });
  // Ports sortie
  b.ports_out.forEach(p=>{
    drawPort(p.x,p.y,true,p._h);
    ctx.fillStyle='#8b949e';ctx.font=`${9/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(p.name,p.x-PR/vp.scale-3/vp.scale,p.y);
  });

  // Rendu spécial GROUP : bordure violette épaisse + icone ▸
  if(b.type==='GROUP'){
    ctx.save();
    ctx.strokeStyle = sel ? '#1f6feb' : '#7c3aed';
    ctx.lineWidth = (sel?2.5:1.5)/vp.scale;
    ctx.setLineDash([]);
    rr(b.x,b.y,b.w,b.h,8/vp.scale);ctx.stroke();
    // Icone entrer
    const sz=10/vp.scale;
    ctx.fillStyle='#bc8cff';ctx.font=`${sz}px sans-serif`;
    ctx.textAlign='right';ctx.textBaseline='top';
    ctx.fillText('▸',b.x+b.w-4/vp.scale,b.y+3/vp.scale);
    // Nom du groupe
    ctx.fillStyle='#e0c8ff';ctx.font=`bold ${11/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(b.params.name||'Groupe',b.x+b.w/2,b.y+b.h/2+HDR/4);
    ctx.restore();
  }
  // LED active — couleur selon catégorie du bloc
  if(b.active){
    const ledC = (b.type==='OUTPUT')?'#f0883e':
                 (b.type==='INPUT') ?'#58a6ff':
                 (['TON','TOF','TP','WAIT','WAITH','PULSE'].includes(b.type))?'#bc8cff':
                 (['CTU','CTD','CTUD','RUNTIMCNT'].includes(b.type))?'#39d353':
                 (['PID','PT_IN','ANA_IN','SENSOR'].includes(b.type))?'#00d4ff':
                 (b.type==='DV')?'#f0883e':'#3fb950';
    const lr=5/vp.scale;
    // Halo
    ctx.shadowColor=ledC; ctx.shadowBlur=8/vp.scale;
    ctx.fillStyle=ledC+'55';
    ctx.beginPath();ctx.arc(b.x+b.w-8/vp.scale,b.y+8/vp.scale,lr*1.8,0,Math.PI*2);ctx.fill();
    // LED pleine
    ctx.shadowBlur=0;
    ctx.fillStyle=ledC;
    ctx.beginPath();ctx.arc(b.x+b.w-8/vp.scale,b.y+8/vp.scale,lr,0,Math.PI*2);ctx.fill();
    // Reflet
    ctx.fillStyle='#ffffff55';
    ctx.beginPath();ctx.arc(b.x+b.w-9.5/vp.scale,b.y+6.5/vp.scale,lr*0.4,0,Math.PI*2);ctx.fill();
    // Bordure active colorée
    ctx.strokeStyle=ledC+'80'; ctx.lineWidth=1.5/vp.scale;
    rr(b.x+1/vp.scale,b.y+1/vp.scale,b.w-2/vp.scale,b.h-2/vp.scale,5/vp.scale); ctx.stroke();
    ctx.shadowBlur=0;
  } else {
    // LED éteinte (gris discret)
    ctx.fillStyle='#30363d';
    ctx.beginPath();ctx.arc(b.x+b.w-8/vp.scale,b.y+8/vp.scale,3.5/vp.scale,0,Math.PI*2);ctx.fill();
  }

  // Décoration connecteurs inter-pages
  if(b.type==='PAGE_IN'||b.type==='PAGE_OUT'){
    const col=b.type==='PAGE_IN'?'#39d353':'#f0883e';
    ctx.fillStyle=col;ctx.font=`bold ${9/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.fillText(`↔ ${b.params.signal||'?'}`,b.x+b.w/2,b.y+b.h-2/vp.scale);
    // Flèche directionnelle
    ctx.fillStyle=col;
    if(b.type==='PAGE_IN'){
      // Triangle pointant vers la droite (entrée sur le canvas)
      ctx.beginPath();ctx.moveTo(b.x-8/vp.scale,b.y+b.h/2-5/vp.scale);
      ctx.lineTo(b.x-8/vp.scale,b.y+b.h/2+5/vp.scale);
      ctx.lineTo(b.x,b.y+b.h/2);ctx.closePath();ctx.fill();
    } else {
      ctx.beginPath();ctx.moveTo(b.x+b.w,b.y+b.h/2-5/vp.scale);
      ctx.lineTo(b.x+b.w,b.y+b.h/2+5/vp.scale);
      ctx.lineTo(b.x+b.w+8/vp.scale,b.y+b.h/2);ctx.closePath();ctx.fill();
    }
  }
  if(_trendVisible&&['SENSOR','PT_IN','ANA_IN'].includes(b.type)){try{_drawTrend(b);}catch(e){}}
  if(b.type==='CONN'){
    ctx.fillStyle='#58a6ff';ctx.font=`bold ${14/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(b.params.num||'?',b.x+b.w/2,b.y+b.h/2+HDR/4);
  }
  // Poignée de redimensionnement — EN DEHORS du bloc (coin SE externe)
  if(sel){
    const hs=7/vp.scale;  // taille du carré
    const hx=b.x+b.w+1/vp.scale;  // juste à droite du bord
    const hy=b.y+b.h+1/vp.scale;  // juste en dessous du bord
    ctx.fillStyle='#ffffff';
    ctx.fillRect(hx-1/vp.scale, hy-1/vp.scale, hs+2/vp.scale, hs+2/vp.scale);
    ctx.fillStyle='#1f6feb';
    ctx.fillRect(hx, hy, hs, hs);
    // Ligne diagonale pour indiquer resize
    ctx.strokeStyle='#ffffff';
    ctx.lineWidth=1.5/vp.scale;
    ctx.beginPath();
    ctx.moveTo(hx+2/vp.scale, hy+hs-1/vp.scale);
    ctx.lineTo(hx+hs-1/vp.scale, hy+2/vp.scale);
    ctx.stroke();
  }
}

function drawPort(cx,cy,isOut,hover){
  ctx.beginPath();ctx.arc(cx,cy,PR/vp.scale,0,Math.PI*2);
  ctx.fillStyle=hover?'#f0883e':isOut?'#3fb950':'#58a6ff';
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--fbd-bg').trim()||'#0d1117';ctx.lineWidth=1/vp.scale;
  ctx.fill();ctx.stroke();
}

function pdisp(b){
  const p=b.params;
  if(b.type==='GROUP') return b.params.name||'Groupe';
  if(b.type==='GROUP_IN') return b.params.label||'IN';
  if(b.type==='GROUP_OUT') return b.params.label||'Q';
  if(b.type==='INPUT')  return GPIO_NAMES[p.pin]||`GPIO ${p.pin}`;
  if(b.type==='OUTPUT') return GPIO_NAMES[p.pin]||`GPIO ${p.pin}`;
  if(b.type==='CONST')  return`= ${p.value}`;
  if(b.type==='MEM')    return p.bit;
  if(b.type==='PAGE_IN'||b.type==='PAGE_OUT')return'';
  if(b.type==='CONN')   return'';
  if(['TON','TOF','TP'].includes(b.type))return`${p.preset_ms}ms`;
  if(['CTU','CTD','CTUD'].includes(b.type))return`PV=${p.preset}`;
  if(b.type==='PT_IN')  return p.name||p.analog_ref||'PT0';
  if(b.type==='ANA_IN') return p.name||p.analog_ref||'ANA0';
  if(b.type==='COMPARE_F')return`${p.reg_ref} ${p.op||'>'} ${p.threshold}`;
  if(b.type==='SCALE')  return`${p.reg_ref}→${p.reg_out}`;
  if(b.type==='PID')    return`SP=${p.setpoint} Kp=${p.kp}`;
  // Nouveaux blocs
  if(b.type==='SENSOR')  return p.name||p.ref||'ANA0';
  if(b.type==='ADD')     return`${p.reg_a}+${p.reg_b}`;
  if(b.type==='SUB')     return`${p.reg_a}-${p.reg_b}`;
  if(b.type==='MUL')     return`${p.reg_a}×${p.reg_b}`;
  if(b.type==='DIV')     return`${p.reg_a}÷${p.reg_b}`;
  if(b.type==='MUX')     return`idx:${p.idx_ref}`;
  if(b.type==='COMPH')   return`${p.ref}≥${p.high}`;
  if(b.type==='COMPL')   return`${p.ref}≤${p.low}`;
  if(b.type==='XOR')     return'XOR';
  if(b.type==='INV')     return'INV';
  if(b.type==='WAIT')    return`${p.delay_s}s`;
  if(b.type==='WAITH')   return`${p.delay_s}s`;
  if(b.type==='PULSE')   return`${p.duration_s}s`;
  if(b.type==='BACKUP')  return p.varname||'backup0';
  if(b.type==='AV')      return p.varname||'av0';
  if(b.type==='DV')      return p.varname||'dv0';
  if(b.type==='STOAV')   return p.varname||'av0';
  if(b.type==='STOAP')   return p.varname||'timer0';
  if(b.type==='LOCALTIME')return'HH:MM WD';
  if(b.type==='SR_R')    return p.bit||'M0';
  if(b.type==='SR_S')    return p.bit||'M1';
  if(b.type==='PLANCHER')   return p.name||'Plancher';
  if(b.type==='CHAUDIERE')  return p.name||'Chaudière';
  if(b.type==='SOLAR')      return p.name||'Solaire';
  if(b.type==='ZONE_CHAUF') return p.name||'Zone';
  if(b.type==='ECS_BLOC')   return p.name||'ECS';
  if(b.type==='CARITHM') return p.name||'Code C';
  if(b.type==='PYBLOCK')  return p.name||'Python';
  if(b.type==='CONTACTOR')return p.name||'K1';
  if(b.type==='VALVE3V') return p.name||'V3V';
  if(b.type==='RUNTIMCNT')return p.name||'Cpt';
  return'';
}

function rr(x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}
function rrTop(x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();
}

// ════════════════════════════════════════════════════════════
// HIT TEST
// ════════════════════════════════════════════════════════════
function hitBlock(wx,wy){
  const bs=pg().blocks;
  for(let i=bs.length-1;i>=0;i--){
    const b=bs[i];if(wx>=b.x&&wx<=b.x+b.w&&wy>=b.y&&wy<=b.y+b.h)return b;
  }return null;
}
function hitPort(wx,wy){
  for(const b of pg().blocks){
    for(const p of b.ports_in) if(Math.hypot(wx-p.x,wy-p.y)<(PR*2.5/vp.scale))return{block:b,port:p,type:'in'};
    for(const p of b.ports_out)if(Math.hypot(wx-p.x,wy-p.y)<(PR*2.5/vp.scale))return{block:b,port:p,type:'out'};
  }return null;
}
function hitWire(wx,wy){
  for(const w of pg().wires){
    if(!('sx'in w))continue;
    for(let i=0;i<32;i++){
      const pt=bezPt(w.sx,w.sy,w.dx,w.dy,i/32);
      if(Math.hypot(wx-pt.x,wy-pt.y)<7/vp.scale)return w;
    }
  }return null;
}

// ════════════════════════════════════════════════════════════
// MULTI-SÉLECTION
// ════════════════════════════════════════════════════════════

// Ajouter/retirer un bloc de la sélection multiple
function toggleMultiSel(b){
  if(multiSel.has(b)) multiSel.delete(b);
  else multiSel.add(b);
}

// Sélectionner tous les blocs dans un rectangle (coords canvas)
function selectInRect(rx,ry,rw,rh){
  if(!pg()) return;
  multiSel.clear();
  const x0=Math.min(rx,rx+rw), y0=Math.min(ry,ry+rh);
  const x1=Math.max(rx,rx+rw), y1=Math.max(ry,ry+rh);
  pg().blocks.forEach(b=>{
    const cx=b.x+b.w/2, cy=b.y+b.h/2;
    if(cx>=x0&&cx<=x1&&cy>=y0&&cy<=y1) multiSel.add(b);
  });
}

// Dessiner le rectangle de sélection rubber-band
function drawRubber(){
  if(!rubberRect) return;
  const {x,y,w,h}=rubberRect;
  ctx.save();
  ctx.strokeStyle='#58a6ff';ctx.lineWidth=1/vp.scale;ctx.setLineDash([4/vp.scale,3/vp.scale]);
  ctx.fillStyle='rgba(88,166,255,0.06)';
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
  ctx.setLineDash([]);ctx.restore();
}

// ════════════════════════════════════════════════════════════
// INTERACTIONS
// ════════════════════════════════════════════════════════════
cvs.addEventListener('mousedown',e=>{
  if(!pg())return;
  if(e.button===1||(e.button===0&&e.altKey)){
    drag='pan';panSX=e.clientX-vp.x;panSY=e.clientY-vp.y;cvs.style.cursor='grabbing';return;
  }
  const w=tw(e.offsetX,e.offsetY);
  // Poignée SE externe — zone de hit calée sur la poignée dessinée
  if(selB&&!selB.locked){
    const hs=7/vp.scale;
    const hx=selB.x+selB.w+1/vp.scale;
    const hy=selB.y+selB.h+1/vp.scale;
    const margin=4/vp.scale;
    if(w.x>=hx-margin&&w.x<=hx+hs+margin&&
       w.y>=hy-margin&&w.y<=hy+hs+margin){
      _rszB=selB;
      _rszOrig={w:selB.w,h:selB.h,mx:w.x,my:w.y};
      drag='resize';cvs.style.cursor='se-resize';
      e.preventDefault();
      return;
    }
  }
  const ph=hitPort(w.x,w.y);
  if(ph){wireFrom={bid:ph.block.id,port:ph.port.name,portType:ph.type,wx:ph.port.x,wy:ph.port.y};drag='wire';return;}
  const bh=hitBlock(w.x,w.y);
  if(bh){
    if(e.ctrlKey||e.metaKey){
      // Ctrl+clic : ajouter/retirer de la sélection multiple
      toggleMultiSel(bh);
      selB=bh; selW=null;
      showBlockProps(bh); render(); return;
    }
    if(multiSel.size>1 && multiSel.has(bh)){
      // Clic sur un bloc déjà dans la sélection → déplacer le groupe
      drag='group';
      dragOX=w.x-bh.x; dragOY=w.y-bh.y;
      selB=bh; selW=null;
      render(); return;
    }
    // Clic simple : sélection unique
    multiSel.clear();
    selB=bh; selW=null;
    drag='block'; dragOX=w.x-bh.x; dragOY=w.y-bh.y;
    pg().blocks=[...pg().blocks.filter(b=>b!==bh),bh];
    showBlockProps(bh); render(); return;
  }
  const wh=hitWire(w.x,w.y);
  if(wh){selW=wh;selB=null;multiSel.clear();showWireProps(wh);render();return;}
  // Clic sur fond vide
  if(!e.ctrlKey && !e.metaKey) multiSel.clear();
  selB=null; selW=null; showEmptyProps();
  // Démarrer rubber-band
  rubberStart={x:w.x,y:w.y}; rubberRect=null; drag='rubber';
  render();
});

cvs.addEventListener('mousemove',e=>{
  lastMX=e.offsetX;lastMY=e.offsetY;
  const w=tw(e.offsetX,e.offsetY);
  let nr=false;
  if(pg())pg().blocks.forEach(b=>{
    [...b.ports_in,...b.ports_out].forEach(p=>{
      const was=p._h;p._h=Math.hypot(w.x-p.x,w.y-p.y)<(PR*2.5/vp.scale);
      if(was!==p._h)nr=true;
    });
  });
  if(drag==='pan'){vp.x=e.clientX-panSX;vp.y=e.clientY-panSY;drawGrid();render();}
  else if(drag==='resize'&&_rszB&&_rszOrig){
    const dx=w.x-_rszOrig.mx, dy=w.y-_rszOrig.my;
    _rszB.w=Math.max(80, Math.round((_rszOrig.w+dx)/GRID)*GRID);
    _rszB.h=Math.max(40, Math.round((_rszOrig.h+dy)/GRID)*GRID);
    _updPortsPos(_rszB);  // repositionne sans écraser b.h
    _rewireBlock(_rszB);
    render();_dirty=true;return;
  }
  else if(drag==='block'&&selB){moveBlock(selB,w.x-dragOX,w.y-dragOY);render();}
  else if(drag==='group'&&selB){
    // Déplacer tout le groupe
    const dx=(w.x-dragOX)-selB.x, dy=(w.y-dragOY)-selB.y;
    multiSel.forEach(b=>{b.x+=dx;b.y+=dy;updPorts(b);});
    // Recalc fils
    pg().wires.forEach(wr=>{
      const sb=pg().blocks.find(b=>b.id===wr.src.bid);
      const db=pg().blocks.find(b=>b.id===wr.dst.bid);
      if(sb&&db){
        const sp=sb.ports_out.find(p=>p.name===wr.src.port);
        const dp=db.ports_in.find(p=>p.name===wr.dst.port);
        if(sp&&dp){wr.sx=sp.x;wr.sy=sp.y;wr.dx=dp.x;wr.dy=dp.y;}
      }
    });
    dragOX=w.x-selB.x; dragOY=w.y-selB.y;
    render();
  }
  else if(drag==='rubber'&&rubberStart){
    rubberRect={x:rubberStart.x,y:rubberStart.y,w:w.x-rubberStart.x,h:w.y-rubberStart.y};
    render();
  }
  else if(drag==='wire'){render();}
  else if(nr){render();}

  // Curseur se-resize sur poignée externe SE
  if(selB&&!drag){
    const hs=7/vp.scale, margin=5/vp.scale;
    const hx=selB.x+selB.w+1/vp.scale, hy=selB.y+selB.h+1/vp.scale;
    if(w.x>=hx-margin&&w.x<=hx+hs+margin&&w.y>=hy-margin&&w.y<=hy+hs+margin){
      cvs.style.cursor='se-resize';
    } else if(cvs.style.cursor==='se-resize'){
      cvs.style.cursor='default';
    }
  }
  const ph=hitPort(w.x,w.y);
  const tt=document.getElementById('tt');
  if(ph){tt.style.display='block';tt.style.left=(e.clientX+14)+'px';tt.style.top=(e.clientY-10)+'px';
    tt.textContent=`${ph.block.type}.${ph.port.name} (${ph.type==='in'?'entrée':'sortie'})`;}
  else tt.style.display='none';

  const onBlk=hitBlock(w.x,w.y);
  const isGroup=onBlk&&multiSel.size>1&&multiSel.has(onBlk);
  cvs.style.cursor=drag?(drag==='pan'||drag==='rubber'?'crosshair':'grabbing')
    :(ph?'crosshair':(isGroup?'move':(onBlk?'grab':'default')));
});

cvs.addEventListener('mouseup',e=>{
  const w=tw(e.offsetX,e.offsetY);
  if(drag==='wire'&&wireFrom){
    const ph=hitPort(w.x,w.y);
    if(ph&&ph.block.id!==wireFrom.bid){
      let sb,sp,db,dp;
      if(wireFrom.portType==='out'&&ph.type==='in'){sb=wireFrom.bid;sp=wireFrom.port;db=ph.block.id;dp=ph.port.name;}
      else if(wireFrom.portType==='in'&&ph.type==='out'){sb=ph.block.id;sp=ph.port.name;db=wireFrom.bid;dp=wireFrom.port;}
      if(sb)addWire(sb,sp,db,dp);
    }
    wireFrom=null;
  }
  if(drag==='rubber'&&rubberRect){
    selectInRect(rubberRect.x,rubberRect.y,rubberRect.w,rubberRect.h);
    if(multiSel.size===1){selB=[...multiSel][0];showBlockProps(selB);multiSel.clear();}
    else if(multiSel.size===0){showEmptyProps();}
    else{selB=null;showEmptyProps();}
    rubberRect=null; rubberStart=null;
  }
  drag=null;_rszB=null;_rszOrig=null;cvs.style.cursor='default';pushUndo();render();
});

cvs.addEventListener('dblclick',e=>{
  const w=tw(e.offsetX,e.offsetY);
  const hit=hitBlock(w.x,w.y);
  if(hit && hit.type==='GROUP'){ enterGroup(hit); return; }
  if(hit && hit.type==='CARITHM'){ openCarithmEditor(hit); return; }
  if(hit && hit.type==='PYBLOCK'){ openPyblockEditor(hit); return; }
  const _metierTypes=['PLANCHER','CHAUDIERE','SOLAR','ZONE_CHAUF','ECS_BLOC',
    'SENSOR','CONTACTOR','VALVE3V','RUNTIMCNT','TON','TOF','TP','WAIT','WAITH',
    'PULSE','BACKUP','AV','DV','PID','COMPH','COMPL','SR_R','SR_S'];
  if(hit && _metierTypes.includes(hit.type)){ openBlockEditor(hit); return; }
  if(!hit)showQMenu(e.clientX,e.clientY,w.x,w.y);
});

cvs.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const w=tw(e.offsetX,e.offsetY);
  const bh=hitBlock(w.x,w.y);
  if(bh){
    selB=bh; multiSel.clear(); render();
    if(bh.type==='GROUP'){
      // Menu contextuel groupe
      if(qm){qm.remove();qm=null;}
      const m=document.createElement('div');
      m.style.cssText=`position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:500;
        background:var(--fbd-bg2);border:1px solid #7c3aed;border-radius:8px;
        font:11px 'JetBrains Mono',monospace;color:var(--fbd-text);
        box-shadow:0 8px 32px #000c;min-width:200px;overflow:hidden;`;
      const items=[
        {l:'▸ Entrer dans le groupe', a:()=>enterGroup(bh)},
        {l:'⊞ Dégrouper',             a:ungroupSelected},
        {l:'──────────',              a:null},
        {l:'⬆ Exporter vers bibliothèque', a:()=>exportGroupToLibrary(bh)},
        {l:'──────────',              a:null},
        {l:'Copier',                  a:copyBlock},
        {l:'Supprimer',               a:()=>delBlock(bh)},
      ];
      items.forEach(({l,a})=>{
        const it=document.createElement('div');
        if(!a){it.style.cssText='height:1px;background:var(--fbd-border);margin:2px 0;';m.appendChild(it);return;}
        it.style.cssText='padding:7px 14px;cursor:pointer;';
        it.textContent=l;
        it.addEventListener('mouseenter',()=>it.style.background='#2a1050');
        it.addEventListener('mouseleave',()=>it.style.background='');
        it.addEventListener('click',()=>{a();m.remove();qm=null;});
        m.appendChild(it);
      });
      document.body.appendChild(m);qm=m;
      setTimeout(()=>document.addEventListener('click',()=>{m.remove();qm=null;},{once:true}),50);
      return;
    }
    // Menu contextuel blocs métiers
    const _metierTypes2=['PLANCHER','CHAUDIERE','SOLAR','ZONE_CHAUF','ECS_BLOC',
      'SENSOR','CONTACTOR','VALVE3V','RUNTIMCNT','TON','TOF','TP',
      'WAIT','WAITH','PULSE','BACKUP','AV','DV','PID','COMPH','COMPL','SR_R','SR_S'];
    if(_metierTypes2.includes(bh.type)){
      if(qm){qm.remove();qm=null;}
      const _bc=DEFS[bh.type]||{};
      const m=document.createElement('div');
      m.style.cssText=`position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:500;
        background:var(--fbd-bg2);border:1px solid ${_bc.bdg||'#58a6ff'};border-radius:8px;
        font:11px 'JetBrains Mono',monospace;color:var(--fbd-text);
        box-shadow:0 8px 32px #000c;min-width:200px;overflow:hidden;`;
      [{l:`📋 Éditer ${bh.type}`, a:()=>openBlockEditor(bh)},
       {l:'──────────',a:null},
       {l:'Copier',a:copyBlock},
       {l:'Supprimer',a:()=>delBlock(bh)}
      ].forEach(({l,a})=>{
        const it=document.createElement('div');
        if(!a){it.style.cssText='height:1px;background:var(--fbd-border);margin:2px 0;';m.appendChild(it);return;}
        it.style.cssText='padding:7px 14px;cursor:pointer;';
        it.textContent=l;
        it.addEventListener('mouseenter',()=>it.style.background='#1a2a3a');
        it.addEventListener('mouseleave',()=>it.style.background='');
        it.addEventListener('click',()=>{a();m.remove();qm=null;});
        m.appendChild(it);
      });
      document.body.appendChild(m);qm=m;
      setTimeout(()=>document.addEventListener('click',()=>{m.remove();qm=null;},{once:true}),50);
      return;
    }
    // Menu contextuel CARITHM
    if(bh.type==='CARITHM'){
      if(qm){qm.remove();qm=null;}
      const m=document.createElement('div');
      m.style.cssText=`position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:500;
        background:var(--fbd-bg2);border:1px solid #ff4040;border-radius:8px;
        font:11px 'JetBrains Mono',monospace;color:var(--fbd-text);
        box-shadow:0 8px 32px #000c;min-width:180px;overflow:hidden;`;
      [{l:'📝 Éditer le code',a:()=>openCarithmEditor(bh)},
       {l:'──────────',a:null},
       {l:'Copier',a:copyBlock},
       {l:'Supprimer',a:()=>delBlock(bh)}
      ].forEach(({l,a})=>{
        const it=document.createElement('div');
        if(!a){it.style.cssText='height:1px;background:var(--fbd-border);margin:2px 0;';m.appendChild(it);return;}
        it.style.cssText='padding:7px 14px;cursor:pointer;';
        it.textContent=l;
        it.addEventListener('mouseenter',()=>it.style.background='#2a0a0a');
        it.addEventListener('mouseleave',()=>it.style.background='');
        it.addEventListener('click',()=>{a();m.remove();qm=null;});
        m.appendChild(it);
      });
      document.body.appendChild(m);qm=m;
      setTimeout(()=>document.addEventListener('click',()=>{m.remove();qm=null;},{once:true}),50);
      return;
    }
    // Menu contextuel PYBLOCK
    if(bh.type==='PYBLOCK'){
      if(qm){qm.remove();qm=null;}
      const m=document.createElement('div');
      m.style.cssText=`position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:500;
        background:var(--fbd-bg2);border:1px solid #7c3aed;border-radius:8px;
        font:11px 'JetBrains Mono',monospace;color:var(--fbd-text);
        box-shadow:0 8px 32px #000c;min-width:180px;overflow:hidden;`;
      [{l:'🐍 Éditer le code Python',a:()=>openPyblockEditor(bh)},
       {l:'──────────',a:null},
       {l:'Copier',a:copyBlock},
       {l:'Supprimer',a:()=>delBlock(bh)}
      ].forEach(({l,a})=>{
        const it=document.createElement('div');
        if(!a){it.style.cssText='height:1px;background:var(--fbd-border);margin:2px 0;';m.appendChild(it);return;}
        it.style.cssText='padding:7px 14px;cursor:pointer;';
        it.textContent=l;
        it.addEventListener('mouseenter',()=>it.style.background='#2a1050');
        it.addEventListener('mouseleave',()=>it.style.background='');
        it.addEventListener('click',()=>{a();m.remove();qm=null;});
        m.appendChild(it);
      });
      document.body.appendChild(m);qm=m;
      setTimeout(()=>document.addEventListener('click',()=>{m.remove();qm=null;},{once:true}),50);
      return;
    }
    delBlock(bh); return;
  }
  const wh=hitWire(w.x,w.y);if(wh)delWire(wh);
});

cvs.addEventListener('wheel',e=>{
  e.preventDefault();
  const f=e.deltaY<0?1.1:.91;
  vp.x=e.offsetX-(e.offsetX-vp.x)*f;vp.y=e.offsetY-(e.offsetY-vp.y)*f;
  vp.scale=Math.max(.15,Math.min(vp.scale*f,4));
  drawGrid();render();
},{passive:false});

// ── Presse-papier interne ─────────────────────────────────────────────────
let _clipboard = null;

let _clipboard_group = null;
function copyBlock(){
  if(multiSel.size>1){
    _clipboard_group = [...multiSel].map(b=>JSON.parse(JSON.stringify(b)));
    _clipboard = null; return;
  }
  _clipboard_group = null;
  if(!selB) return;
  _clipboard = JSON.parse(JSON.stringify(selB));
  // Feedback visuel
  const fl = document.getElementById('fbd-copy-flash');
  if(fl){ fl.textContent=`✔ Copié : ${selB.type}`; fl.style.opacity='1'; setTimeout(()=>fl.style.opacity='0',1200); }
}

function pasteBlock(){
  if(_clipboard_group && _clipboard_group.length > 0){
    pushUndo();
    const p = pg();
    const idMap = {};
    _clipboard_group.forEach(bd=>{
      const newId=`B${idCtr++}`; idMap[bd.id]=newId;
    });
    const newBlocks = [];
    _clipboard_group.forEach(bd=>{
      const b={...JSON.parse(JSON.stringify(bd)), id:idMap[bd.id],
               x:bd.x+30, y:bd.y+30, ports_in:[], ports_out:[], active:false};
      b.h=computeH(b.type); updPorts(b); p.blocks.push(b); newBlocks.push(b);
    });
    multiSel = new Set(newBlocks);
    selB=null; notifyChange(); render(); return;
  }
  if(!_clipboard) return;
  pushUndo();
  const b = JSON.parse(JSON.stringify(_clipboard));
  b.id = `B${idCtr++}`;
  b.x += 20; b.y += 20;   // décalage pour que la copie soit visible
  updPorts(b);
  pg().blocks.push(b);
  selB = b; selW = null;
  showBlockProps(b);
  notifyChange(); render();
}

document.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea'))return;
  if(e.key==='Delete'||e.key==='Backspace'){
    if(multiSel.size>1){
      // Supprimer tous les blocs sélectionnés
      pushUndo();
      multiSel.forEach(b=>{ delBlock(b); });
      multiSel.clear(); selB=null; showEmptyProps(); render();
    } else if(selB) delBlock(selB);
    else if(selW) delWire(selW);
  }
  if((e.ctrlKey||e.metaKey)&&e.key==='a'){
    e.preventDefault();
    multiSel=new Set(pg().blocks);
    selB=null; selW=null; showEmptyProps(); render();
  }
  if(e.key==='f'||e.key==='F')fitView();
  if(e.key==='ArrowLeft'&&e.altKey){e.preventDefault();if(cur>0)goPage(cur-1);}
  if(e.key==='ArrowRight'&&e.altKey){e.preventDefault();if(cur<pages.length-1)goPage(cur+1);}
  if(e.ctrlKey&&(e.key==='z'||e.key==='Z')){e.preventDefault();undo();}
  if(e.ctrlKey&&(e.key==='y'||e.key==='Y')){e.preventDefault();redo();}
  if(e.ctrlKey&&e.shiftKey&&(e.key==='z'||e.key==='Z')){e.preventDefault();redo();}
  if(e.ctrlKey&&(e.key==='c'||e.key==='C')){e.preventDefault();copyBlock();}
  if(e.ctrlKey&&(e.key==='v'||e.key==='V')){e.preventDefault();pasteBlock();}
  if(e.ctrlKey&&(e.key==='g'||e.key==='G')){e.preventDefault();groupSelected();}
  if(e.ctrlKey&&e.shiftKey&&(e.key==='g'||e.key==='G')){e.preventDefault();ungroupSelected();}
  if(e.key==='Escape'&&groupStack.length){ exitGroup(); }
});

// ════════════════════════════════════════════════════════════
// MENU RAPIDE
// ════════════════════════════════════════════════════════════
let qm=null;
function showQMenu(cx,cy,wx,wy){
  if(qm){qm.remove();qm=null;}
  const m=document.createElement('div');
  m.style.cssText=`position:fixed;left:${cx}px;top:${cy}px;z-index:400;
    background:var(--fbd-bg2);border:1px solid var(--fbd-border);border-radius:8px;
    font:10px 'JetBrains Mono',monospace;color:var(--fbd-text);
    box-shadow:0 8px 32px #000c;min-width:196px;overflow:hidden;
    max-height:380px;overflow-y:auto;`;
  const groups={};
  Object.entries(DEFS).forEach(([t,d])=>{if(!groups[d.cat])groups[d.cat]=[];groups[d.cat].push([t,d]);});
  Object.entries(groups).forEach(([cat,items])=>{
    const s=document.createElement('div');
    s.style.cssText='padding:4px 10px 2px;font-size:9px;color:var(--fbd-text3);text-transform:uppercase;letter-spacing:1px;border-top:1px solid var(--fbd-border);';
    s.textContent=cat;m.appendChild(s);
    items.forEach(([t,d])=>{
      const it=document.createElement('div');
      it.style.cssText='padding:5px 12px;cursor:pointer;display:flex;gap:8px;align-items:center;';
      it.innerHTML=`<span style="color:${d.bdg};font-weight:bold;min-width:56px;font-size:10px">${t}</span><span style="color:var(--fbd-text2);font-size:9px">${d.desc}</span>`;
      it.addEventListener('mouseenter',()=>it.style.background='#1c2128');
      it.addEventListener('mouseleave',()=>it.style.background='');
      it.addEventListener('click',()=>{addBlock(t,wx,wy);m.remove();qm=null;});
      m.appendChild(it);
    });
  });
  document.body.appendChild(m);qm=m;
  setTimeout(()=>document.addEventListener('click',()=>{m.remove();qm=null;},{once:true}),50);
}

// ════════════════════════════════════════════════════════════
// PROPRIÉTÉS
// ════════════════════════════════════════════════════════════
function showEmptyProps(){
  document.getElementById('props-body').innerHTML=`<div id="phint">Cliquer sur un bloc<br>pour éditer.<br><br>Double-clic canvas<br>pour ajouter.<br><br>Glisser depuis<br>la palette.</div>`;
}

function showBlockProps(b){
  const d=DEFS[b.type]||{};
  let h=`<div class="pr"><span class="pl">Type</span>
    <div style="color:${d.bdg||'#58a6ff'};font-weight:bold;font-size:12px">${b.type}</div>
    <div style="color:var(--fbd-text2);font-size:9px;margin-top:1px">${d.desc||''}</div></div>
    <div class="pr"><span class="pl">ID</span><div style="color:#484f58">${b.id}</div></div>
    <hr class="psep">`;

  if(b.type==='INPUT'){
    h+=pSel('pin','GPIO Entrée',b.params.pin,GPIO_IN.map(p=>({v:p,l:`GPIO ${p}${GPIO_NAMES[p]?' — '+GPIO_NAMES[p]:''}`})));
    h+=pTxt('name','Nom',b.params.name||'');
  }else if(b.type==='OUTPUT'){
    h+=pSel('pin','GPIO Sortie',b.params.pin,GPIO_OUT.map(p=>({v:p,l:`GPIO ${p}${GPIO_NAMES[p]?' — '+GPIO_NAMES[p]:''}`})));
    h+=pTxt('name','Nom',b.params.name||'');
  }else if(b.type==='CONST'){
    h+=pNum('value','Valeur',b.params.value||0,-9999,9999);
  }else if(b.type==='MEM'){
    h+=pSel('bit','Bit mémoire',b.params.bit,MEMS.map(m=>({v:m,l:m})));
  }else if(b.type==='PAGE_IN'||b.type==='PAGE_OUT'){
    h+=pTxt('signal','Nom du signal',b.params.signal||'SIG1');
    const avail=findSignalPeers(b);
    h+=`<hr class="psep"><span class="pl">Signal présent sur</span>`;
    if(!avail.length){
      h+=`<div style="color:var(--fbd-text3);font-size:9px">Aucune correspondance.</div>`;
    } else {
      avail.forEach(c=>{
        h+=`<div class="conn-row" onclick="goPage(${c.pageIdx})">
          <span>${c.signal}</span>
          <span><span class="conn-chip" style="background:#1a2f45;color:#58a6ff">${c.pageName}</span>
          <span class="conn-jump">→</span></span></div>`;
      });
    }
  }else if(b.type==='CONN'){
    h+=pNum('num','Numéro',b.params.num||1,1,999);
    h+=pTxt('label','Étiquette',b.params.label||'C1');
    const avail=findConnPeers(b);
    h+=`<hr class="psep"><span class="pl">Connecteurs jumelés</span>`;
    if(!avail.length){
      h+=`<div style="color:var(--fbd-text3);font-size:9px">Aucun #${b.params.num}.</div>`;
    } else {
      avail.forEach(c=>{
        h+=`<div class="conn-row" onclick="goPage(${c.pageIdx})">
          <span>#${c.num} ${c.label}</span>
          <span class="conn-chip" style="background:#1a2f45;color:#58a6ff">${c.pageName}</span>
          <span class="conn-jump">→</span></div>`;
      });
    }
  }else if(b.type==='TON'||b.type==='TOF'||b.type==='TP'){
    h+=pNum('preset_ms','Preset (ms)',b.params.preset_ms||1000,10,60000);
  }else if(b.type==='CTU'||b.type==='CTD'||b.type==='CTUD'){
    h+=pNum('preset','Preset (coups)',b.params.preset||10,1,9999);
  }else if(b.type==='PT_IN'){
    h+=pTxt('name','Nom de la sonde',b.params.name||'Sonde PT100');
    h+=pSel('pt_type','Type sonde',b.params.pt_type||'pt100',PT_TYPES);
    h+=pSel('spi_ch','Port SPI',b.params.spi_ch||0,SPI_CH);
    h+=pNum('wires','Câblage (fils)',b.params.wires||3,2,4);
    h+=pSel('reg_out','Registre sortie (°C)',b.params.reg_out||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<hr class="psep"><span class="pl">Simulation — Valeur °C</span>`;
    h+=`<div style="display:flex;gap:6px;align-items:center">
      <input class="pi" id="sim_val_${b.id}" type="range" min="-50" max="200" step="0.5"
        value="${b._simVal||20}" style="flex:1" data-bid="${b.id}">
      <span id="sim_lbl_${b.id}" style="color:#00d4ff;min-width:50px">${(b._simVal||20).toFixed(1)}°C</span>
    </div>`;
  }else if(b.type==='ANA_IN'){
    h+=pTxt('name','Nom entrée',b.params.name||'Entrée ANA');
    h+=pSel('ads_ch','Canal ADS1115',b.params.ads_ch||0,ADS_CH);
    h+=pSel('reg_out','Registre sortie',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<hr class="psep"><span class="pl">Simulation — Valeur (V)</span>`;
    h+=`<div style="display:flex;gap:6px;align-items:center">
      <input class="pi" id="sim_val_${b.id}" type="range" min="0" max="5" step="0.01"
        value="${b._simVal||0}" style="flex:1" data-bid="${b.id}">
      <span id="sim_lbl_${b.id}" style="color:#58cfff;min-width:50px">${(b._simVal||0).toFixed(3)}V</span>
    </div>`;
  }else if(b.type==='COMPARE_F'){
    h+=pSel('reg_ref','Registre mesuré',b.params.reg_ref||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('threshold','Seuil',b.params.threshold||80.0,-9999,9999,0.1);
    h+=pNum('hysteresis','Hystérésis',b.params.hysteresis||1.0,0,100,0.1);
    h+=pSel('op','Opération',b.params.op||'gt',[
      {v:'gt',l:'> (supérieur)'},{v:'lt',l:'< (inférieur)'},
      {v:'ge',l:'>= (supérieur ou égal)'},{v:'le',l:'<= (inférieur ou égal)'},
      {v:'eq',l:'= (égal +/-hyst)'}
    ]);
  }else if(b.type==='SCALE'){
    h+=pSel('reg_ref','Registre source',b.params.reg_ref||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Registre sortie',b.params.reg_out||'RF2',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<hr class="psep"><span class="pl">Entrée brute</span>`;
    h+=pNum('in_lo','Min entrée',b.params.in_lo||0,-99999,99999,0.001);
    h+=pNum('in_hi','Max entrée',b.params.in_hi||5.0,-99999,99999,0.001);
    h+=`<span class="pl">Sortie</span>`;
    h+=pNum('out_lo','Min sortie',b.params.out_lo||0,-99999,99999,0.1);
    h+=pNum('out_hi','Max sortie',b.params.out_hi||100.0,-99999,99999,0.1);
  }else if(b.type==='PID'){
    h+=pSel('pv_ref','Mesure (PV)',b.params.pv_ref||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('setpoint','Consigne (SP)',b.params.setpoint||50.0,-9999,9999,0.1);
    h+=`<hr class="psep"><span class="pl">Gains PID</span>`;
    h+=pNum('kp','Kp (proportionnel)',b.params.kp||1.0,0,9999,0.01);
    h+=pNum('ki','Ki (intégral)',b.params.ki||0.1,0,9999,0.001);
    h+=pNum('kd','Kd (dérivé)',b.params.kd||0.0,0,9999,0.001);
    h+=`<hr class="psep"><span class="pl">Sortie</span>`;
    h+=pNum('out_min','Min sortie (%)',b.params.out_min||0,-100,100,0.1);
    h+=pNum('out_max','Max sortie (%)',b.params.out_max||100,0,200,0.1);
    h+=pSel('reg_out','Registre sortie',b.params.reg_out||'RF3',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='SENSOR'){
    h+=pTxt('name','Nom capteur',b.params.name||'Capteur');
    h+=pSel('ref','Entrée analogique',b.params.ref||'ANA0',
      Array.from({length:12},(_,i)=>({v:`ANA${i}`,l:`ANA${i} — Sonde ${i+1}`})));
    h+=pNum('correction','Correction (deg)',b.params.correction||0.0,-20,20,0.1);
  }else if(b.type==='ADD'||b.type==='SUB'||b.type==='MUL'||b.type==='DIV'){
    const ops={ADD:'+',SUB:'-',MUL:'x',DIV:'/'};
    h+=`<span class="pl">RF_A ${ops[b.type]} RF_B vers RF_OUT</span>`;
    h+=pSel('reg_a','Opérande A',b.params.reg_a||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_b','Opérande B',b.params.reg_b||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Résultat',b.params.reg_out||'RF2',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='MUX'){
    h+=pSel('idx_ref','Index (bit mémoire)',b.params.idx_ref||'M0',MEMS.map(m=>({v:m,l:m})));
    h+=pSel('in0','In0 (idx=0)',b.params.in0||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('in1','In1 (idx=1)',b.params.in1||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('in2','In2 (idx=2)',b.params.in2||'RF2',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('in3','In3 (idx=3)',b.params.in3||'RF3',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie',b.params.reg_out||'RF4',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='COMPH'){
    h+=pSel('ref','Registre mesuré',b.params.ref||'RF0',[...REG_REFS,...ANA_REFS].map(r=>({v:r,l:r})));
    h+=pNum('high','Seuil HAUT',b.params.high??80.0,-9999,9999,0.1);
    h+=pNum('hyst','Hystérésis',b.params.hyst??0.5,0,100,0.1);
    h+=pSel('reg_out','Sortie',b.params.reg_out||'M0',[...MEMS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≥HAUT, OFF si IN&lt;(HAUT−hyst)</div>`;
  }else if(b.type==='COMPL'){
    h+=pSel('ref','Registre mesuré',b.params.ref||'RF0',[...REG_REFS,...ANA_REFS].map(r=>({v:r,l:r})));
    h+=pNum('low','Seuil BAS',b.params.low??10.0,-9999,9999,0.1);
    h+=pNum('hyst','Hystérésis',b.params.hyst??0.5,0,100,0.1);
    h+=pSel('reg_out','Sortie',b.params.reg_out||'M1',[...MEMS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≤BAS, OFF si IN>(BAS+hyst)</div>`;
  }else if(b.type==='ABS'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie |IN|',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='MIN'||b.type==='MAX'){
    h+=pSel('reg_a','Entrée A',b.params.reg_a||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_b','Entrée B',b.params.reg_b||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie',b.params.reg_out||'RF2',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='MOD'||b.type==='POW'){
    h+=pSel('reg_a',b.type==='POW'?'Base':'Dividende',b.params.reg_a||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_b',b.type==='POW'?'Exposant':'Diviseur',b.params.reg_b||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie',b.params.reg_out||'RF2',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='SQRT'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie √IN',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">√max(0, IN)</div>`;
  }else if(b.type==='CLAMP'||b.type==='CLAMP_A'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie clampée',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('lo','Minimum',b.params.lo??0.0,-9999,9999,0.1);
    h+=pNum('hi','Maximum',b.params.hi??100.0,-9999,9999,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">Sortie CLIP=TRUE si IN hors plage</div>`;
  }else if(b.type==='SEL'){
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:2px 0">G=0 → IN0 · G=1 → IN1</div>`;
    h+=pSel('in0','IN0 (G=0)',b.params.in0||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('in1','IN1 (G=1)',b.params.in1||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie',b.params.reg_out||'RF2',REG_REFS.map(r=>({v:r,l:r})));
  }else if(b.type==='FILT1'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie filtrée',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('tc_s','Constante de temps (s)',b.params.tc_s??10.0,0.01,3600,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">α=dt/(tc+dt) — plus tc grand = plus lent</div>`;
  }else if(b.type==='AVG'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie moyenne',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('n','Nb échantillons',b.params.n??10,2,200,1);
  }else if(b.type==='INTEG'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie intégrale',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('ki','Gain Ki',b.params.ki??1.0,-100,100,0.01);
    h+=pNum('lo','Min sortie',b.params.lo??-1000,-1e6,0,0.1);
    h+=pNum('hi','Max sortie',b.params.hi??1000,0,1e6,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">OUT=MAX si saturé · RES remet à 0</div>`;
  }else if(b.type==='DERIV'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie dérivée',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('kd','Gain Kd',b.params.kd??1.0,-100,100,0.01);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">OUT = Kd × ΔIN/Δt</div>`;
  }else if(b.type==='DEADB'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('dead','Bande morte (±)',b.params.dead??1.0,0,1000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">|IN|≤dead → OUT=0 · DEAD=TRUE si actif</div>`;
  }else if(b.type==='RAMP'){
    h+=pSel('reg_sp','Consigne (cible)',b.params.reg_sp||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie rampée',b.params.reg_out||'RF1',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('rate','Vitesse max (/s)',b.params.rate??1.0,0.001,10000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">DONE=TRUE quand OUT a atteint SP</div>`;
  }else if(b.type==='HYST'){
    h+=pSel('reg_in','Entrée',b.params.reg_in||'RF0',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('sp','Point milieu',b.params.sp??50.0,-9999,9999,0.1);
    h+=pNum('band','Bande totale',b.params.band??2.0,0,1000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≥sp+band/2 · OFF si IN≤sp−band/2</div>`;
  }else if(b.type==='MUX'){
    h+=pSel('idx_ref','Index (RF ou M)',b.params.idx_ref||'RF0',[...REG_REFS,...MEMS].map(r=>({v:r,l:r})));
    h+=pNum('n_in','Nb entrées',b.params.n_in||4,2,8,1);
    for(let i=0;i<(b.params.n_in||4);i++)
      h+=pSel(`in${i}`,`IN${i}`,b.params[`in${i}`]||`RF${i}`,REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_out','Sortie VAL',b.params.reg_out||'RF4',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">Sélectionne IN[idx] → VAL</div>`;
  }else if(b.type==='WAIT'){
    h+=pTxt('name','Nom',b.params.name||'Attente');
    h+=pNum('delay_s','Delai (s)',b.params.delay_s||5,0,3600,1);
  }else if(b.type==='WAITH'){
    h+=pTxt('name','Nom',b.params.name||'Tempo desact');
    h+=pNum('delay_s','Delai desact. (s)',b.params.delay_s||5,0,3600,1);
  }else if(b.type==='PULSE'){
    h+=pTxt('name','Nom',b.params.name||'Impulsion');
    h+=pNum('duration_s','Duree (s)',b.params.duration_s||3,0,3600,0.1);
  }else if(b.type==='BACKUP'){
    h+=pTxt('varname','Nom variable',b.params.varname||'backup0');
    h+=pSel('bktype','Type',b.params.bktype||'float',[{v:'float',l:'Analogique (float)'},{v:'bool',l:'Booléen (bool)'}]);
    h+=pNum('default','Valeur par défaut',parseFloat(b.params.default)||0,-9999,9999,0.01);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0;line-height:1.6">Port <b>VAL</b> bidirectionnel — source+restitution<br><span style="color:#d4c800">💾 Non-volatile — survit aux coupures</span></div>`;
  }else if(b.type==='AV'){
    h+=pTxt('varname','Nom variable',b.params.varname||'av0');
    h+=pNum('default','Valeur par defaut',b.params.default??0.0,-9999,9999,0.01);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">
      Source pure — expose la valeur courante (OUT seulement)
    </div>`;
  }else if(b.type==='DV'){
    h+=pTxt('varname','Nom variable',b.params.varname||'dv0');
    h+=`<span class="pl">Valeur defaut</span>
      <select class="ps" data-key="default">
        <option value="false" ${!b.params.default?'selected':''}>FALSE</option>
        <option value="true"  ${b.params.default?'selected':''}>TRUE</option>
      </select>`;
  }else if(b.type==='STOAV'||b.type==='STOAP'){
    h+=pTxt('varname','Variable cible',b.params.varname||'var0');
  }else if(b.type==='LOCALTIME'){
    h+=`<div style="color:var(--fbd-text2);font-size:10px;padding:4px 0">
      Sorties :<br>
      HOUR = heure (0-23)<br>
      MDAY = jour du mois (1-31)<br>
      WDAY = jour semaine (0=Dim..6=Sam)
    </div>`;
  }else if(b.type==='SR_R'||b.type==='SR_S'){
    h+=pSel('bit','Bit memoire',b.params.bit||'M0',MEMS.map(m=>({v:m,l:m})));
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">
      ${b.type==='SR_R'?'Reset prioritaire':'Set prioritaire'}
    </div>`;
  }else if(b.type==='PLANCHER'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    const refs=[{v:'',l:'— non câblé —'},...ANA_REFS,...REG_REFS].map(r=>typeof r==='string'?({v:r,l:r}):r);
    h+=pTxt('name','Nom',p.name||'Plancher');
    h+=`<hr class="psep"><span class="pl">🌡 Sondes</span>`;
    h+=pSel('pv_ref_amb','Sonde ambiante (PV principal)',p.pv_ref_amb||'RF0',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pSel('pv_ref_depart','Sonde départ eau chaude',p.pv_ref_depart||'',refs);
    h+=pSel('pv_ref_retour','Sonde retour plancher',p.pv_ref_retour||'',refs);
    h+=`<hr class="psep"><span class="pl">🎯 Consignes</span>`;
    h+=pNum('sp','Consigne ambiante (°C)',p.sp??20.0,5,35,0.5);
    h+=pNum('dead_band','Bande morte (°C)',p.dead_band??0.5,0,5,0.1);
    h+=pNum('max_depart','Limite max départ (°C)',p.max_depart??45.0,30,60,0.5);
    h+=pNum('min_delta','Delta min dép−ret (°C)',p.min_delta??3.0,0,20,0.5);
    h+=`<hr class="psep"><span class="pl">🎛 Gains PID</span>`;
    h+=pNum('kp','Kp (proportionnel)',p.kp??2.0,0,50,0.1);
    h+=pNum('ki','Ki (intégral)',p.ki??0.1,0,10,0.01);
    h+=pNum('kd','Kd (dérivé)',p.kd??0.5,0,10,0.01);
    h+=`<hr class="psep"><span class="pl">🔧 Sorties</span>`;
    h+=pSel('out_v3v_ouv','V3V → Ouvre',p.out_v3v_ouv||'k7',dvOpts);
    h+=pSel('out_v3v_fer','V3V → Ferme',p.out_v3v_fer||'k8',dvOpts);
    h+=pSel('out_circ','Circulateur plancher',p.out_circ||'k9',dvOpts);
    h+=`<hr class="psep"><span class="pl">📊 Registres diagnostic</span>`;
    h+=pSel('reg_out','Sortie PID (%)',p.reg_out||'RF8',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_depart','Registre T départ',p.reg_depart||'RF9',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_retour','Registre T retour',p.reg_retour||'RF10',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_delta','Registre Δ dép−ret',p.reg_delta||'RF11',REG_REFS.map(r=>({v:r,l:r})));
    h+=pNum('min_temp','Sécurité gel (°C)',p.min_temp??5.0,-10,15,0.5);
    h+=pNum('max_temp','Sécurité max ambiante (°C)',p.max_temp??35.0,25,45,0.5);
    h+=`<div style="color:#ff7043;font-size:9px;padding:6px 0;line-height:1.5">
      PID sur T ambiante. Vanne + pompe actives si besoin chauffe.<br>
      Sécurité si T départ > max ou T ambiante hors bornes.<br>
      Delta dép−ret = efficacité échange plancher (diagnostic).</div>`;

  }else if(b.type==='CHAUDIERE'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    h+=pTxt('name','Nom',p.name||'Chaudière');
    h+=`<hr class="psep"><span class="pl">🌡 Températures</span>`;
    h+=pSel('pv_ref_retour','Sonde retour',p.pv_ref_retour||'RF1',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pSel('pv_ref_depart','Sonde départ',p.pv_ref_depart||'RF2',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pNum('sp','Consigne départ (°C)',p.sp??65.0,40,90,1);
    h+=pNum('hysteresis','Hystérésis (°C)',p.hysteresis??3.0,0.5,10,0.5);
    h+=`<hr class="psep"><span class="pl">⏱ Anti-cyclage</span>`;
    h+=pNum('min_on_s','Temps min ON (s)',p.min_on_s??60,10,300,10);
    h+=pNum('min_off_s','Temps min OFF (s)',p.min_off_s??30,5,300,5);
    h+=`<hr class="psep"><span class="pl">🔧 Sorties & Sécurités</span>`;
    h+=pSel('out_brulee','Sortie brûleur',p.out_brulee||'k3',dvOpts);
    h+=pSel('out_pompe','Sortie pompe',p.out_pompe||'k4',dvOpts);
    h+=pNum('max_depart','Sécurité max départ (°C)',p.max_depart??90.0,70,105,1);
    h+=`<div style="color:#ff5252;font-size:9px;padding:4px 0">
      Brûleur ON si T_départ&lt;SP−hystérésis. Anti-cyclage évite les démarrages trop fréquents.</div>`;

  }else if(b.type==='SOLAR'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    const refs=[{v:'',l:'— non câblé —'},...ANA_REFS,...REG_REFS].map(r=>typeof r==='string'?({v:r,l:r}):r);
    h+=pTxt('name','Nom',p.name||'Solaire');
    h+=`<hr class="psep"><span class="pl">☀ Sondes</span>`;
    h+=pSel('pv_ref_capteur','Sonde capteur solaire',(p.pv_ref_capteur||'RF0'),[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pSel('pv_ref_ecs','Sonde ballon ECS',(p.pv_ref_ecs||'RF3'),[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pSel('pv_ref_chauf','Sonde ballon chauffage',(p.pv_ref_chauf||''),refs);
    h+=`<hr class="psep"><span class="pl">🌡 ΔT démarrage pompe</span>`;
    h+=pNum('delta_on','ΔT ON — démarrage pompe (°C)',p.delta_on??8.0,2,30,0.5);
    h+=pNum('delta_off','ΔT OFF — arrêt pompe (°C)',p.delta_off??3.0,1,20,0.5);
    h+=`<div style="color:#ffd740;font-size:9px;padding:2px 0">Pompe démarre si T_capteur − T_ballon ≥ ΔT_ON</div>`;
    h+=`<hr class="psep"><span class="pl">🎯 Consignes ballons</span>`;
    h+=pNum('sp_ecs','Consigne ECS prioritaire (°C)',p.sp_ecs??60.0,40,80,0.5);
    h+=pNum('sp_chauf','Consigne chauffage (°C)',p.sp_chauf??50.0,30,70,0.5);
    h+=`<div style="color:#ffd740;font-size:9px;padding:2px 0">
      ECS en priorité. Si ECS atteinte → bascule vers chauffage si sonde câblée.</div>`;
    h+=`<hr class="psep"><span class="pl">⚡ Mode pompe solaire</span>`;
    const pumpMode=p.pump_mode||'on_off';
    h+=`<div class="prop-row"><div class="prop-label">Mode</div>
      <select class="prop-input" onchange="
        const isAna=this.value==='analog_0_10';
        document.getElementById('solar-onoff-row').style.display=isAna?'none':'flex';
        document.getElementById('solar-ana-row').style.display=isAna?'flex':'none';
        document.getElementById('solar-ana-params').style.display=isAna?'flex':'none';
        wProp(b.id,'pump_mode',this.value);">
        <option value="on_off" ${pumpMode==='on_off'?'selected':''}>🔴 Tout ou rien (TOR)</option>
        <option value="analog_0_10" ${pumpMode==='analog_0_10'?'selected':''}>〰 Analogique 0-10V</option>
      </select></div>`;
    // TOR
    h+=`<div id="solar-onoff-row" style="display:${pumpMode==='on_off'?'flex':'none'}">`;
    h+=pSel('out_pompe','Sortie pompe (DV)',p.out_pompe||'k1',dvOpts);
    h+=`</div>`;
    // Analogique 0-10V
    const avOpts=[{v:'',l:'— non configuré —'},...['av1','av2','av3','av4','av5','av6'].map(v=>({v,l:v.toUpperCase()}))];
    h+=`<div id="solar-ana-row" style="display:${pumpMode==='analog_0_10'?'flex':'none'}">`;
    h+=pSel('out_pompe_av','Sortie pompe AV (0-10V)',p.out_pompe_av||'',avOpts);
    h+=`</div>`;
    h+=`<div id="solar-ana-params" style="display:${pumpMode==='analog_0_10'?'flex':'none'};flex-direction:column;gap:4px">`;
    h+=pNum('pump_min_pct','Vitesse mini (%)',p.pump_min_pct??10.0,0,50,1);
    h+=pNum('pump_delta_max','ΔT → vitesse 100% (°C)',p.pump_delta_max??30.0,5,60,1);
    h+=`<div style="color:#ffd740;font-size:9px;padding:2px 0">Vitesse = linéaire entre ΔT_ON (min%) et ΔT_max (100%)</div>`;
    h+=`</div>`;
    h+=`<hr class="psep"><span class="pl">🔧 Vannes directionnelles</span>`;
    h+=pSel('out_vanne_ecs','Vanne → ECS',p.out_vanne_ecs||'k2',dvOpts);
    h+=pSel('out_vanne_chauf','Vanne → Chauffage',p.out_vanne_chauf||'k3',dvOpts);
    h+=`<hr class="psep"><span class="pl">🛡 Sécurités</span>`;
    h+=pNum('max_capteur','Sécurité surchauffe capteur (°C)',p.max_capteur??120.0,80,150,1);
    h+=pNum('min_capteur','Déclenchement protection gel (°C)',p.min_capteur??5.0,-10,15,0.5);
    h+=`<hr class="psep"><span class="pl">❄ Protection anti-gel capteurs</span>`;
    const agMode=p.antigel_mode||'off';
    h+=`<div class="prop-row"><div class="prop-label">Source eau chaude</div>
      <select class="prop-input" onchange="
        const on=this.value!=='off';
        document.getElementById('ag-params').style.display=on?'flex':'none';
        wProp(b.id,'antigel_mode',this.value);">
        <option value="off"       ${agMode==='off'      ?'selected':''}>🚫 Désactivé — tout OFF au gel</option>
        <option value="chaudiere" ${agMode==='chaudiere'?'selected':''}>🔥 Chaudière → capteurs</option>
        <option value="ecs"       ${agMode==='ecs'      ?'selected':''}>💧 Ballon ECS → capteurs</option>
      </select></div>`;
    h+=`<div id="ag-params" style="display:${agMode!=='off'?'flex':'none'};flex-direction:column;gap:4px">`;
    h+=pNum('antigel_temp_source','T° mini source (°C)',p.antigel_temp_source??30.0,20,70,1);
    h+=`<div style="color:#40c4ff;font-size:9px;padding:3px 0;line-height:1.5">
      ✅ Utilise la <b>vanne chauffage</b> (configurée ci-dessous) pour faire<br>
      circuler l'eau chaude dans le circuit solaire.<br>
      Pompe solaire activée si source ≥ T° mini.</div>`;
    h+=`</div>`;
    h+=`<hr class="psep"><span class="pl">📊 Registres diagnostic</span>`;
    h+=pSel('reg_delta','Registre ΔT capteur−ballon',p.reg_delta||'RF12',REG_REFS.map(r=>({v:r,l:r})));
    h+=pSel('reg_rendement','Registre énergie captée (%)',p.reg_rendement||'RF13',REG_REFS.map(r=>({v:r,l:r})));
    h+=`<div style="color:#69f0ae;font-size:9px;padding:4px 0;line-height:1.5">
      Vanne ECS ON = solaire vers ECS. Vanne Chauf ON = solaire vers plancher/chaudière.<br>
      Les deux vannes ne s'ouvrent jamais simultanément.</div>`;

  }else if(b.type==='ZONE_CHAUF'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    h+=pTxt('name','Nom zone',p.name||'Zone');
    h+=`<hr class="psep"><span class="pl">🌡 Régulation</span>`;
    h+=pSel('pv_ref','Sonde température',p.pv_ref||'RF0',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pNum('sp','Consigne (°C)',p.sp??20.0,5,35,0.5);
    h+=pNum('hysteresis','Hystérésis (°C)',p.hysteresis??0.5,0.1,5,0.1);
    h+=`<hr class="psep"><span class="pl">🔧 Vanne & Délais</span>`;
    h+=pSel('out_vanne','Sortie vanne',p.out_vanne||'k5',dvOpts);
    h+=pNum('delay_open_s','Délai ouverture (s)',p.delay_open_s??120,0,600,10);
    h+=pNum('delay_close_s','Délai fermeture (s)',p.delay_close_s??120,0,600,10);
    h+=`<div style="color:#69f0ae;font-size:9px;padding:4px 0">
      Vanne s'ouvre si TEMP&lt;SP−hystérésis, se ferme si TEMP≥SP+hystérésis.</div>`;

  }else if(b.type==='ECS_BLOC'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    h+=pTxt('name','Nom',p.name||'ECS');
    h+=`<hr class="psep"><span class="pl">🌡 Températures</span>`;
    h+=pSel('pv_ref_ecs','Sonde ballon ECS',p.pv_ref_ecs||'RF3',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pSel('pv_ref_prim','Sonde primaire',p.pv_ref_prim||'RF4',[...ANA_REFS,...REG_REFS].map(r=>({v:r,l:r})));
    h+=pNum('sp_ecs','Consigne ECS (°C)',p.sp_ecs??55.0,40,70,0.5);
    h+=pNum('hysteresis','Hystérésis (°C)',p.hysteresis??2.0,0.5,10,0.5);
    h+=`<hr class="psep"><span class="pl">🦠 Anti-légionellose</span>`;
    h+=pNum('sp_antileg','Consigne anti-légio (°C)',p.sp_antileg??65.0,60,80,0.5);
    h+=pSel('antileg_day','Jour',p.antileg_day??0,[
      {v:0,l:'Dimanche'},{v:1,l:'Lundi'},{v:2,l:'Mardi'},{v:3,l:'Mercredi'},
      {v:4,l:'Jeudi'},{v:5,l:'Vendredi'},{v:6,l:'Samedi'}]);
    h+=pNum('antileg_hour','Heure (0-23)',p.antileg_hour??3,0,23,1);
    h+=`<hr class="psep"><span class="pl">🔧 Sortie</span>`;
    h+=pSel('out_pompe','Sortie pompe ECS',p.out_pompe||'k6',dvOpts);
    h+=`<div style="color:#40c4ff;font-size:9px;padding:4px 0">
      Pompe active si T_ECS&lt;SP et T_prim>T_ECS+3°C. Anti-légio hebdomadaire automatique.</div>`;

  }else if(b.type==='PYBLOCK'){
    h+=pTxt('name','Nom du bloc',b.params.name||'PyBlock');
    h+=`<hr class="psep"><span class="pl">Entrées</span>`;
    h+=pNum('n_a','Nb A (float)',b.params.n_a||2,0,8,1);
    h+=pNum('n_d','Nb d (bool)',b.params.n_d||1,0,8,1);
    h+=pNum('n_i','Nb I (int)',b.params.n_i||0,0,2,1);
    h+=`<span class="pl">Sorties</span>`;
    h+=pNum('n_oa','Nb OA (float)',b.params.n_oa||1,0,8,1);
    h+=pNum('n_od','Nb od (bool)',b.params.n_od||1,0,8,1);
    h+=pNum('n_oi','Nb OI (int)',b.params.n_oi||0,0,2,1);
    const pyVal=(b.params.code||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h+=`<hr class="psep"><span class="pl" style="color:#7c3aed">🐍 Code Python</span>
    <div style="color:var(--fbd-text2);font-size:9px;padding:2px 0 4px;line-height:1.6">
      A1..A4 · d1..d4 · I1 · OA1..OA2 · od1..od3 · dt · cycle · state</div>
    <textarea id="pyblock_code_${b.id}" style="width:100%;height:180px;background:#0a0a18;
      color:#c9d1d9;border:1px solid #7c3aed;border-radius:4px;padding:6px;
      font-family:'JetBrains Mono',monospace;font-size:10px;resize:vertical;"
      spellcheck="false">${pyVal}</textarea>`;
  }else if(b.type==='CARITHM'){
    h+=pTxt('name','Nom du bloc',b.params.name||'CArithm');
    h+=`<hr class="psep"><span class="pl">Entrees</span>`;
    h+=pNum('n_a','Nb A (analogiques)',b.params.n_a||2,0,8,1);
    h+=pNum('n_d','Nb d (booleennes)',b.params.n_d||1,0,7,1);
    h+=pNum('n_i','Nb I (entieres)',b.params.n_i||0,0,2,1);
    h+=`<span class="pl">Sorties</span>`;
    h+=pNum('n_oa','Nb OA (analogiques)',b.params.n_oa||0,0,8,1);
    h+=pNum('n_od','Nb od (booleennes)',b.params.n_od||1,0,8,1);
    h+=pNum('n_oi','Nb OI (entieres)',b.params.n_oi||0,0,2,1);
    h+=`<hr class="psep"><span class="pl" style="color:#ff6040">Code C embarque</span>`;
    const codeVal=(b.params.code||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h+=`<textarea id="carithm_code_${b.id}" style="width:100%;height:200px;background:#0a0a0a;color:var(--fbd-text);border:1px solid #ff4040;border-radius:4px;padding:6px;font-family:'JetBrains Mono',Consolas,monospace;font-size:10px;resize:vertical;" spellcheck="false">${codeVal}</textarea>
    <div style="color:var(--fbd-text3);font-size:9px;margin-top:3px">
      A1..A8 analog | d1..d7 bool | I1,I2 int<br>
      OA1..OA8 | od1..od8 | OI1 (sorties)<br>
      <span style="color:#d29922">Syntaxe C : if/else, operateurs</span>
    </div>`;
  }else if(b.type==='GROUP'){
    h+=pTxt('name','Nom du groupe',b.params.name||'Groupe');
    const nIn  = (b.params._port_ins||[]).length;
    const nOut = (b.params._port_outs||[]).length;
    h+=`<div class="pr"><span class="pl">Ports</span><div style="color:#bc8cff">${nIn} entrée(s) · ${nOut} sortie(s)</div></div>`;
    h+=`<div class="pr"><button onclick="enterGroup(selB)" style="width:100%;padding:8px;background:#2a1050;border:1px solid #7c3aed;border-radius:5px;color:#bc8cff;cursor:pointer;font-size:12px;">▸ Entrer dans le groupe</button></div>`;
    h+=`<div class="pr"><button onclick="ungroupSelected()" style="width:100%;padding:6px;background:#2a0a0a;border:1px solid #f85149;border-radius:5px;color:#f85149;cursor:pointer;font-size:11px;margin-top:4px;">✕ Dégrouper</button></div>`;
  }else if(b.type==='GROUP_IN'||b.type==='GROUP_OUT'){
    h+=pTxt('label','Nom du port',b.params.label||'');
  }else if(b.type==='CONTACTOR'){
    h+=pTxt('name','Nom contacteur',b.params.name||'K1');
    h+=pSel('pin','GPIO sortie',b.params.pin||17,GPIO_OUT.map(p=>({v:p,l:`GPIO ${p}${GPIO_NAMES[p]?' — '+GPIO_NAMES[p]:''}`})));
  }else if(b.type==='VALVE3V'){
    h+=pTxt('name','Nom vanne',b.params.name||'V3V');
    h+=pSel('pin_inc','GPIO +ouvre',b.params.pin_inc||20,GPIO_OUT.map(p=>({v:p,l:`GPIO ${p}${GPIO_NAMES[p]?' — '+GPIO_NAMES[p]:''}`})));
    h+=pSel('pin_dec','GPIO +ferme',b.params.pin_dec||21,GPIO_OUT.map(p=>({v:p,l:`GPIO ${p}${GPIO_NAMES[p]?' — '+GPIO_NAMES[p]:''}`})));
  }else if(b.type==='RUNTIMCNT'){
    h+=pTxt('name','Nom compteur',b.params.name||'Compteur1');
    h+=pTxt('reg_starts','RF → nb démarrages',b.params.reg_starts||'');
    h+=pTxt('reg_total','RF → heures totales',b.params.reg_total||'');
    h+=pTxt('reg_runtime','RF → session (s)',b.params.reg_runtime||'');
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0;line-height:1.6"><b>RUN</b>=marche <b>RST</b>=reset<br><span style="color:#50ff50">ID bloc: ${b.id}</span></div>`;
  }

  h+=`<hr class="psep">
    <div style="color:var(--fbd-text3);font-size:9px;margin-bottom:6px">
      ↓ ${d.ins&&d.ins.length?d.ins.join(', '):'—'}<br>
      ↑ ${d.outs&&d.outs.length?d.outs.join(', '):'—'}
    </div>`;
  h+=`<div style="display:flex;gap:6px;margin-bottom:4px;">`;
  h+=pNum('_bw','Largeur (px)',b.w,60,600,20);
  h+=pNum('_bh','Hauteur (px)',b.h,30,400,10);
  h+=`</div>`;
  h+=`<button class="pb danger" onclick="delSel()">✕ Supprimer</button>`;

  document.getElementById('props-body').innerHTML=h;

  // Listeners input/select standards
  document.getElementById('props-body').querySelectorAll('input,select').forEach(el=>{
    el.addEventListener('change',()=>{
      const k=el.dataset.key;
      if(!k) return;
      pushUndo();
      // Champs spéciaux _bw/_bh = largeur/hauteur du bloc
      if(k==='_bw'){ b.w=Math.max(60,Number(el.value)); _updPortsPos(b); _rewireBlock(b); notifyChange(); render(); return; }
      if(k==='_bh'){ b.h=Math.max(30,Number(el.value)); _updPortsPos(b); _rewireBlock(b); notifyChange(); render(); return; }
      b.params[k]=el.type==='number'?Number(el.value):(el.type==='range'?Number(el.value):el.value);
      notifyChange(); render();
      if(b.type==='PAGE_IN'||b.type==='PAGE_OUT'||b.type==='CONN') showBlockProps(b);
      if(b.type==='CARITHM') { updPortsCarithm(b); render(); }
      if(b.type==='PYBLOCK')  { updPortsPyblock(b);  render(); }
      if(b.type==='PYBLOCK')  { updPortsPyblock(b);  render(); }
      if(b.type==='PYBLOCK')  { updPortsPyblock(b);  render(); }
    });
  });

  // Curseur simulation analogique (PT_IN / ANA_IN)
  const simSlider=document.getElementById(`sim_val_${b.id}`);
  if(simSlider){
    simSlider.addEventListener('input',e=>{
      const val=parseFloat(e.target.value);
      b._simVal=val;
      const lbl=document.getElementById(`sim_lbl_${b.id}`);
      if(lbl) lbl.textContent=b.type==='PT_IN'?val.toFixed(1)+'°C':val.toFixed(3)+'V';
      if(window.pybridge){
        const ref=b.params.analog_ref||(b.type==='PT_IN'?'PT0':'ANA0');
        window.pybridge.set_analog_sim(ref, val);
      }
    });
  }

  // Editeur code CARITHM
  const pyArea=document.getElementById(`pyblock_code_${b.id}`);
  if(pyArea){
    pyArea.addEventListener('input',()=>{ b.params.code=pyArea.value; notifyChange(); });
    pyArea.addEventListener('keydown',e=>{
      if(e.key==='Tab'){e.preventDefault();const s=pyArea.selectionStart;
        pyArea.value=pyArea.value.substring(0,s)+'    '+pyArea.value.substring(pyArea.selectionEnd);
        pyArea.selectionStart=pyArea.selectionEnd=s+4; b.params.code=pyArea.value; notifyChange();}
    });
  }
  const codeArea=document.getElementById(`carithm_code_${b.id}`);
  if(codeArea){
    codeArea.addEventListener('input',()=>{ b.params.code=codeArea.value; notifyChange(); });
    codeArea.addEventListener('keydown',e=>{
      if(e.key==='Tab'){
        e.preventDefault();
        const s=codeArea.selectionStart;
        codeArea.value=codeArea.value.substring(0,s)+'  '+codeArea.value.substring(codeArea.selectionEnd);
        codeArea.selectionStart=codeArea.selectionEnd=s+2;
        b.params.code=codeArea.value; notifyChange();
      }
    });
  }
}

function showWireProps(w){
  const p=pg();
  const sb=p.blocks.find(b=>b.id===w.src.bid);
  const db=p.blocks.find(b=>b.id===w.dst.bid);
  document.getElementById('props-body').innerHTML=`
    <div class="pr"><span class="pl">Fil</span><div style="color:#58a6ff">${w.id}</div></div>
    <div class="pr"><span class="pl">Source</span><div>${sb?sb.type:'?'} [${w.src.bid}].${w.src.port}</div></div>
    <div class="pr"><span class="pl">Destination</span><div>${db?db.type:'?'} [${w.dst.bid}].${w.dst.port}</div></div>
    <hr class="psep">
    <button class="pb danger" onclick="delSel()">✕ Supprimer</button>`;
}

function pSel(k,l,v,opts){
  return`<div class="pr"><span class="pl">${l}</span>
    <select class="ps" data-key="${k}">${opts.map(o=>`<option value="${o.v}" ${o.v==v?'selected':''}>${o.l}</option>`).join('')}</select></div>`;
}
function pTxt(k,l,v){
  return`<div class="pr"><span class="pl">${l}</span><input class="pi" data-key="${k}" type="text" value="${v}"></div>`;
}
function pNum(k,l,v,min=0,max=99999,step=1){
  return`<div class="pr"><span class="pl">${l}</span><input class="pi" data-key="${k}" type="number" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}
function delSel(){if(selB)delBlock(selB);else if(selW)delWire(selW);}

// ════════════════════════════════════════════════════════════
// CONNEXIONS INTER-PAGES
// ════════════════════════════════════════════════════════════
function findSignalPeers(b){
  const sig=b.params.signal;
  const invType=b.type==='PAGE_OUT'?'PAGE_IN':'PAGE_OUT';
  const res=[];
  pages.forEach((pg,i)=>{
    if(i===cur)return;
    pg.blocks.forEach(ob=>{
      if(ob.type===invType&&ob.params.signal===sig)
        res.push({signal:sig,pageName:pg.name,pageIdx:i,bid:ob.id});
    });
  });
  return res;
}

function findConnPeers(b){
  const num=b.params.num;
  const res=[];
  pages.forEach((pg,i)=>{
    if(i===cur)return;
    pg.blocks.forEach(ob=>{
      if(ob.type==='CONN'&&ob.params.num===num)
        res.push({num,label:ob.params.label||'',pageName:pg.name,pageIdx:i,bid:ob.id});
    });
  });
  return res;
}

// ════════════════════════════════════════════════════════════
// FIT VIEW
// ════════════════════════════════════════════════════════════
function fitView(){
  const p=pg();if(!p||!p.blocks.length){vp.x=40;vp.y=40;vp.scale=1;drawGrid();render();return;}
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  p.blocks.forEach(b=>{x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h);});
  const W=cvs.width-60,H=cvs.height-60;
  vp.scale=Math.max(.2,Math.min(Math.min(W/(x1-x0+80),H/(y1-y0+80)),2.5));
  vp.x=30-x0*vp.scale+40;vp.y=30-y0*vp.scale+40;
  drawGrid();render();
}

// ════════════════════════════════════════════════════════════
// SÉRIALISATION
// ════════════════════════════════════════════════════════════
function getDiagram(){
  // Sortir des groupes avant de sauvegarder (garantit que l'état est cohérent)
  exitAllGroups();
  return{
    pages:pages
      .filter(p=>!p.id.startsWith('__grp_'))  // exclure les pages internes des groupes
      .map(p=>({
        id:p.id,name:p.name,
        blocks:p.blocks.map(b=>({id:b.id,type:b.type,x:b.x,y:b.y,w:b.w,h:b.h,params:{...b.params}})),
        wires: p.wires.map(w=>({id:w.id,src:{...w.src},dst:{...w.dst}}))
      })),
    curPage: Math.min(cur, pages.filter(p=>!p.id.startsWith('__grp_')).length-1)
  };
}

function loadDiagram(data){
  if(!data||!data.pages)return;
  pages=[];idCtr=1;
  data.pages.filter(pd=>!pd.id.startsWith('__grp_')).forEach(pd=>{
    const p={id:pd.id,name:pd.name,blocks:[],wires:[]};
    pgVP[pd.id]={x:40,y:40,scale:1};
    pd.blocks.forEach(bd=>{
      const _params = {...defParams(bd.type),...bd.params};
      // h : utiliser la valeur sauvegardée si elle est explicitement > valeur calculée
      // (permet le redimensionnement manuel), sinon recalculer
      const _computedH = computeH(bd.type);
      const _savedH = (bd.h && bd.h > _computedH) ? bd.h : _computedH;
      const _savedW = bd.w || BW;
      const b={id:bd.id,type:bd.type,x:bd.x,y:bd.y,w:_savedW,h:_savedH,
               params:_params,ports_in:[],ports_out:[],active:false};
      updPorts(b);  // updPorts recalcule h pour GROUP/CARITHM/PYBLOCK
      // Réappliquer les dimensions manuelles après updPorts si nécessaire
      if(bd.h && bd.h > computeH(bd.type)) { b.h=_savedH; _updPortsPos(b); }
      if(bd.w && bd.w !== BW) { b.w=_savedW; _updPortsPos(b); }
      p.blocks.push(b);
      const n=parseInt(bd.id.replace(/\D/g,''));if(n>=idCtr)idCtr=n+1;
    });
    pd.wires.forEach(wd=>{
      const w={id:wd.id,src:{...wd.src},dst:{...wd.dst}};
      // recalc sur cette page
      const sb=p.blocks.find(b=>b.id===w.src.bid);
      const db=p.blocks.find(b=>b.id===w.dst.bid);
      if(sb&&db){
        const sp=sb.ports_out.find(pp=>pp.name===w.src.port);
        const dp=db.ports_in.find(pp=>pp.name===w.dst.port);
        if(sp&&dp){w.sx=sp.x;w.sy=sp.y;w.dx=dp.x;w.dy=dp.y;}
      }
      p.wires.push(w);
      const n=parseInt(wd.id.replace(/\D/g,''));if(n>=idCtr)idCtr=n+1;
    });
    pages.push(p);
  });
  cur=Math.min(data.curPage||0,pages.length-1);
  updateNav();selB=null;selW=null;showEmptyProps();
  const sv=pgVP[pages[cur].id];vp.x=sv.x;vp.y=sv.y;vp.scale=sv.scale;
  // Vider le stack et activer l'undo APRÈS le chargement complet
  _undoStack=[];_redoStack=[];
  _undoEnabled=true;
  _updateUndoUI();
  // Dessiner dans rAF — garantit que cvs.width/height sont > 0
  requestAnimationFrame(()=>{
    resize();
    fitView();
  });
}

function updateActiveStates(state){
  if(!state||!pg())return;
  pg().blocks.forEach(b=>{
    const p=b.params||{};
    switch(b.type){
      // ── E/S GPIO ──────────────────────────────────────────────────
      case'INPUT':{const v=state.gpio&&state.gpio[String(p.pin)];b.active=v?!!v.value:false;break;}
      case'OUTPUT':{const v=state.gpio&&state.gpio[String(p.pin)];b.active=v?!!v.value:false;break;}
      // ── Mémoire et DV ─────────────────────────────────────────────
      case'MEM': {b.active=!!(state.memory&&state.memory[p.bit]);break;}
      case'DV':  {const vn=(p.varname||'').toLowerCase();
                  b.active=!!(state.dv_vars&&(state.dv_vars[vn]||state.dv_vars[p.varname]));break;}
      // ── Timers ───────────────────────────────────────────────────
      case'TON':
      case'TOF':
      case'TP':  {const t=state.timers&&state.timers[b.id];b.active=t?!!t.done:false;break;}
      case'WAIT':
      case'WAITH':
      case'PULSE':{const t=state.timers&&state.timers[b.id];b.active=t?!!t.done:false;break;}
      // ── Compteurs ────────────────────────────────────────────────
      case'CTU':
      case'CTD':
      case'CTUD':{const c=state.counters&&state.counters[b.id];b.active=c?!!c.done:false;break;}
      case'RUNTIMCNT':{const c=state.pids&&state.pids[b.id];b.active=c?c.output>0:false;break;}
      // ── Logique booléenne (lire GPIO de sortie câblé) ────────────
      case'AND':
      case'OR':
      case'NOT':
      case'XOR':
      case'INV':
      case'COIL':
      case'SET':
      case'RESET':
      case'SR':
      case'RS':
      case'MOVE':
      case'COMPH':
      case'COMPL':
      case'HYST':
      case'COMPARE_F':{
        // Trouver la sortie GPIO ou M* câblée depuis ce bloc
        b.active=false;
        const page=pg();
        for(const w of page.wires){
          if(w.src.bid!==b.id) continue;
          const dst=page.blocks.find(x=>x.id===w.dst.bid);
          if(!dst) continue;
          if(dst.type==='OUTPUT'){
            const v=state.gpio&&state.gpio[String(dst.params.pin||0)];
            if(v&&v.value){b.active=true;break;}
          }
          if(dst.type==='MEM'){
            if(state.memory&&state.memory[dst.params.bit]){b.active=true;break;}
          }
        }
        break;
      }
      // ── Analogique : actif si sortie non nulle ───────────────────
      case'PID':{const pid=state.pids&&state.pids[b.id];b.active=pid?Math.abs(pid.output)>0.01:false;break;}
      case'PT_IN':
      case'ANA_IN':
      case'SENSOR':{
        const ref=p.reg_out||p.analog_ref||'RF0';
        const rv=state.registers&&state.registers[ref];
        b.active=rv!=null&&Math.abs(parseFloat(rv))>0.01;
        break;}
      default: b.active=false;
    }
  });
  render();
}

function notifyChange(){
  if(window.pybridge)window.pybridge.on_diagram_changed(JSON.stringify(getDiagram()));
  setTimeout(showValidationResults, 200);
}

function clearAll(){pages=[];idCtr=1;multiSel=new Set();selB=null;selW=null;addPage('Page 1');}

// ── Importer des blocs dans la page courante (exemples rapides) ──────────────
// Ajoute les blocs/fils du diagramme 'data' à la page active,
// en décalant les positions pour ne pas chevaucher l'existant,
// et en remappant les IDs pour éviter les collisions.
function importBlocks(data){
  if(!data||!data.pages||!data.pages[0]) return;
  const src = data.pages[0];
  if(!src.blocks.length) return;
  pushUndo();

  const p = pg();  // page courante

  // Calcul du décalage : placer les blocs importés à droite/bas des blocs existants
  let maxX = 80, maxY = 40;
  p.blocks.forEach(b=>{ maxX=Math.max(maxX,b.x+b.w+60); maxY=Math.max(maxY,b.y); });
  const offsetX = p.blocks.length ? maxX : 60;
  const offsetY = 40;

  // ── Collecter les noms/varnames déjà utilisés sur TOUTES les pages ──────────
  const usedNames = new Set();
  pages.forEach(pg2=>pg2.blocks.forEach(b=>{
    const pp=b.params||{};
    if(pp.varname) usedNames.add(pp.varname);
    if(pp.name)    usedNames.add(pp.name);
    if(pp.bit)     usedNames.add(pp.bit);
  }));

  // ── Générer un nom unique en ajoutant un suffixe numérique ──────────────────
  function uniqueName(base){
    if(!usedNames.has(base)){ usedNames.add(base); return base; }
    let i=2;
    while(usedNames.has(`${base}_${i}`)) i++;
    const n=`${base}_${i}`; usedNames.add(n); return n;
  }

  // ── Types de blocs dont les params doivent être renommés à l'import ─────────
  const RENAME_VARNAME = new Set(['DV','AV','BACKUP','STOAV','STOAP']);
  const RENAME_NAME    = new Set(['CONTACTOR','VALVE3V','RUNTIMCNT','WAIT','WAITH',
                                   'PULSE','INPUT','OUTPUT','PT_IN','ANA_IN','SENSOR']);

  // Remapper les IDs pour éviter les collisions
  const idMap = {};
  src.blocks.forEach(bd=>{
    const newId = `B${idCtr++}`;
    idMap[bd.id] = newId;
  });

  // Ajouter les blocs avec params renommés
  src.blocks.forEach(bd=>{
    const params = {...defParams(bd.type), ...bd.params};
    // Renommer varname si collision
    if(RENAME_VARNAME.has(bd.type) && params.varname){
      params.varname = uniqueName(params.varname);
    }
    // Renommer name si collision
    if(RENAME_NAME.has(bd.type) && params.name){
      params.name = uniqueName(params.name);
    }
    const b={
      id: idMap[bd.id],
      type: bd.type,
      x: bd.x + offsetX,
      y: bd.y + offsetY,
      w: BW,
      h: computeH(bd.type),
      params,
      ports_in:[], ports_out:[], active:false
    };
    updPorts(b);
    p.blocks.push(b);
  });

  // Ajouter les fils avec IDs remappés
  src.wires.forEach(wd=>{
    const srcBid = idMap[wd.src.bid];
    const dstBid = idMap[wd.dst.bid];
    if(!srcBid||!dstBid) return;
    const sb = p.blocks.find(b=>b.id===srcBid);
    const db = p.blocks.find(b=>b.id===dstBid);
    if(!sb||!db) return;
    const sp = sb.ports_out.find(pp=>pp.name===wd.src.port);
    const dp = db.ports_in.find(pp=>pp.name===wd.dst.port);
    const w={
      id: `W${idCtr++}`,
      src:{bid:srcBid, port:wd.src.port},
      dst:{bid:dstBid, port:wd.dst.port},
      sx: sp?sp.x:0, sy: sp?sp.y:0,
      dx: dp?dp.x:0, dy: dp?dp.y:0
    };
    p.wires.push(w);
  });

  fitView();
  notifyChange();
}

// ════════════════════════════════════════════════════════════
// API EXPOSÉE À PYQT
// ════════════════════════════════════════════════════════════
function setGridSize(px){
  GRID=Math.max(1,px);
  const sel=document.getElementById('nav-grid-select');
  if(sel){
    // Mettre à jour la liste si valeur hors options
    let found=false;
    for(const opt of sel.options){ if(parseInt(opt.value)===GRID){opt.selected=true;found=true;break;} }
    if(!found) sel.value=String(GRID);
  }
  drawGrid(); render();
}
function toggleSnap(){
  SNAP=!SNAP;
  const btn=document.getElementById('nav-snap-toggle');
  if(btn){
    btn.textContent=SNAP?'⊞ Snap':'⬜ Libre';
    btn.classList.toggle('snap-on',SNAP);
  }
}
_updateUndoUI();
window.setFbdTheme=function(name){
  if(name==='light') document.documentElement.classList.add('theme-light');
  else document.documentElement.classList.remove('theme-light');
  drawGrid(); render();
  setTimeout(()=>{drawGrid();render();},80);
};

// ════════════════════════════════════════════════════════════
// INIT — dans requestAnimationFrame pour garantir le layout CSS
// ════════════════════════════════════════════════════════════
addPage('Page 1');   // crée la structure pages[] immédiatement

// fbdAPI exposé immédiatement — loadDiagram peut être appelé avant le premier rendu
// ── setGpioConfig — appelé par le studio quand la config GPIO change ──────────
function setGpioConfig(gpioConfig){
  // gpioConfig = {"17":{"name":"Sortie K1","mode":"output"}, ...}
  GPIO_IN  = [];
  GPIO_OUT = [];
  GPIO_NAMES = {};
  Object.entries(gpioConfig).forEach(([pin, cfg])=>{
    const p = parseInt(pin);
    GPIO_NAMES[p] = cfg.name || ('GPIO'+p);
    if(cfg.mode === 'input')  GPIO_IN.push(p);
    if(cfg.mode === 'output') GPIO_OUT.push(p);
  });
  // Trier les entrées par numéro TOR dans le nom, sinon par pin
  GPIO_IN.sort((a,b)=>{
    const na=GPIO_NAMES[a]||'', nb=GPIO_NAMES[b]||'';
    const ma=na.match(/TOR\s*(\d+)|Entr.e\s*(\d+)/i), mb=nb.match(/TOR\s*(\d+)|Entr.e\s*(\d+)/i);
    if(ma&&mb) return parseInt(ma[1]||ma[2])-parseInt(mb[1]||mb[2]);
    return a-b;
  });
  // Trier les sorties par numéro Kx dans le nom, sinon par pin
  GPIO_OUT.sort((a,b)=>{
    const na=GPIO_NAMES[a]||'', nb=GPIO_NAMES[b]||'';
    const ma=na.match(/K(\d+)/i), mb=nb.match(/K(\d+)/i);
    if(ma&&mb) return parseInt(ma[1])-parseInt(mb[1]);
    return a-b;
  });

  // Mettre à jour les blocs existants dont le pin n'existe plus
  let updated = 0;
  pages.forEach(pg=>{
    pg.blocks.forEach(b=>{
      if(b.type==='INPUT' && !GPIO_IN.includes(b.params.pin)){
        b.params.pin = GPIO_IN[0] || b.params.pin;
        b.params.name = GPIO_NAMES[b.params.pin] || ('GPIO'+b.params.pin);
        updated++;
      }
      if(b.type==='OUTPUT' && !GPIO_OUT.includes(b.params.pin)){
        b.params.pin = GPIO_OUT[0] || b.params.pin;
        b.params.name = GPIO_NAMES[b.params.pin] || ('GPIO'+b.params.pin);
        updated++;
      }
    });
  });
  if(updated > 0){
    notifyChange();
    render();
  }
  return {GPIO_IN, GPIO_OUT, updated};
}

window.fbdAPI={loadDiagram,getDiagram,importBlocks,updateActiveStates,fitView,clearAll,addPage,setGridSize,toggleSnap,undo,redo,setGpioConfig,exportGroupToLibrary,importGroupFromLibrary,getGroupLibrary:()=>_groupLibrary,initCanvas:_initCanvas};

// buildPalette : appels multiples pour garantir l'exécution dans Qt WebEngine
function _initCanvas(){
  buildPalette();
  buildLibraryPanel();
  resize();
  render();
}

// Essai 1 : immédiat
try{ _initCanvas(); } catch(e){}

// Essai 2 : rAF
requestAnimationFrame(()=>{ try{ _initCanvas(); } catch(e){} });

// Essai 3 : DOMContentLoaded (si le script s'exécute avant)
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', ()=>{ try{ _initCanvas(); } catch(e){} });
} else {
  setTimeout(()=>{ try{ _initCanvas(); } catch(e){} }, 50);
}

// Essai 4 : 300ms de délai (pour Qt WebEngine qui injecte QWebChannel)
setTimeout(()=>{ try{ _initCanvas(); } catch(e){} }, 300);

// ════════════════════════════════════════════════════════════
// VALIDATION DU CÂBLAGE FBD
// ════════════════════════════════════════════════════════════
function validateProgram() {
  const errors   = [];
  const warnings = [];
  const allPages = pages;

  allPages.forEach((page, pi) => {
    const blocks = page.blocks;
    const wires  = page.wires;

    // 1. Ports d'entrée non connectés sur blocs critiques
    blocks.forEach(b => {
      const d = DEFS[b.type];
      if (!d) return;
      d.ins.forEach(portName => {
        const connected = wires.some(w => w.dst.bid === b.id && w.dst.port === portName);
        // Ports obligatoires (non optionnels)
        const optional = ['PT', 'EN', 'SP', 'PV'].includes(portName);
        if (!connected && !optional) {
          warnings.push({
            page: pi, bid: b.id,
            msg: `[${page.name}] Bloc ${b.type} (${b.id}) : port "${portName}" non connecté`
          });
        }
      });
    });

    // 2. Fils vers des blocs inexistants
    wires.forEach(w => {
      const src = blocks.find(b => b.id === w.src.bid);
      const dst = blocks.find(b => b.id === w.dst.bid);
      if (!src) errors.push({ page: pi, bid: w.src.bid,
        msg: `[${page.name}] Fil ${w.id} : source "${w.src.bid}" inexistante` });
      if (!dst) errors.push({ page: pi, bid: w.dst.bid,
        msg: `[${page.name}] Fil ${w.id} : destination "${w.dst.bid}" inexistante` });
    });

    // 3. Sorties GPIO dupliquées
    const gpioOuts = {};
    blocks.filter(b => b.type === 'OUTPUT' || b.type === 'CONTACTOR').forEach(b => {
      const pin = b.params.pin;
      if (pin === undefined) return;
      if (gpioOuts[pin]) {
        errors.push({ page: pi, bid: b.id,
          msg: `[${page.name}] GPIO ${pin} utilisé par deux blocs : ${gpioOuts[pin]} et ${b.id}` });
      } else {
        gpioOuts[pin] = b.id;
      }
    });

    // 4. Registres RF lus avant d'être écrits (ordre topologique simplifié)
    const rfWritten = new Set();
    const rfRead    = new Set();
    blocks.forEach(b => {
      const p = b.params || {};
      // Blocs qui écrivent dans un RF
      ['reg_out','reg_a','reg_b'].forEach(k => {
        if (p[k] && p[k].startsWith('RF')) rfWritten.add(p[k]);
      });
      // Blocs qui lisent un RF
      ['reg_ref','pv_ref','ref','reg_a','reg_b'].forEach(k => {
        if (p[k] && p[k].startsWith('RF')) rfRead.add(p[k]);
      });
    });
    rfRead.forEach(rf => {
      if (!rfWritten.has(rf)) {
        warnings.push({ page: pi, bid: null,
          msg: `[${page.name}] Registre ${rf} lu mais jamais écrit sur cette page` });
      }
    });

    // 5. PAGE_OUT sans PAGE_IN correspondant sur les autres pages
    blocks.filter(b => b.type === 'PAGE_OUT').forEach(b => {
      const sig = b.params.signal;
      const found = allPages.some((pg, idx) =>
        idx !== pi && pg.blocks.some(bb => bb.type === 'PAGE_IN' && bb.params.signal === sig));
      if (!found) {
        warnings.push({ page: pi, bid: b.id,
          msg: `[${page.name}] PAGE_OUT "${sig}" sans PAGE_IN correspondant` });
      }
    });

    // 6. Bloc PID sans PV connecté
    blocks.filter(b => b.type === 'PID').forEach(b => {
      const pvRef = b.params.pv_ref;
      if (!pvRef || !pvRef.startsWith('RF')) {
        errors.push({ page: pi, bid: b.id,
          msg: `[${page.name}] Bloc PID (${b.id}) : PV non configuré` });
      }
    });

    // 7. CArithm sans code
    blocks.filter(b => b.type === 'CARITHM').forEach(b => {
      if (!b.params.code || !b.params.code.trim()) {
        warnings.push({ page: pi, bid: b.id,
          msg: `[${page.name}] Bloc CARITHM "${b.params.name||b.id}" : aucun code saisi` });
      }
    });
  });

  return { errors, warnings, valid: errors.length === 0 };
}

function showValidationResults() {
  const result = validateProgram();
  const { errors, warnings, valid } = result;

  // Bouton de validation dans la toolbar
  const btn = document.getElementById('btn-validate');
  if (btn) {
    btn.textContent = valid
      ? `✓ Valide${warnings.length ? ` (${warnings.length} avert.)` : ''}`
      : `✗ ${errors.length} erreur${errors.length > 1 ? 's' : ''}`;
    btn.style.color  = valid ? (warnings.length ? 'var(--amber)' : 'var(--green)') : 'var(--red)';
    btn.style.borderColor = btn.style.color;
  }

  // Panel de résultats
  let panel = document.getElementById('validation-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'validation-panel';
    panel.style.cssText = `position:fixed;bottom:60px;right:16px;width:420px;max-height:300px;
      overflow-y:auto;background:var(--fbd-bg2);border:1px solid var(--fbd-border);border-radius:8px;
      padding:14px;z-index:1000;font-size:12px;font-family:'JetBrains Mono',monospace;
      box-shadow:0 8px 32px #00000080;`;
    // Vérifier que body existe avant d'appender
    if (document.body) document.body.appendChild(panel);
    else return result;
  }

  if (errors.length === 0 && warnings.length === 0) {
    panel.innerHTML = '<div style="color:#3fb950">✓ Programme valide — aucun problème détecté.</div>';
  } else {
    let html = '';
    errors.forEach(e => {
      html += `<div style="color:#f85149;margin-bottom:6px;cursor:pointer"
        onclick="goPage(${e.page})">[ERREUR] ${e.msg}</div>`;
    });
    warnings.forEach(w => {
      html += `<div style="color:#d29922;margin-bottom:6px;cursor:pointer"
        onclick="goPage(${w.page})">[AVERT.] ${w.msg}</div>`;
    });
    panel.innerHTML = html;
  }

  panel.style.display = 'block';
  // Fermer en cliquant ailleurs
  setTimeout(() => {
    const close = e => { if (!panel.contains(e.target)) { panel.style.display='none'; document.removeEventListener('click', close); }};
    document.addEventListener('click', close);
  }, 100);

  return result;
}

// Validation automatique à chaque changement (notifyChange définie plus haut)
function triggerValidation() {
  setTimeout(showValidationResults, 200);
}

// Activer l'undo dès le démarrage (canvas vide = état initial valide)
setTimeout(()=>{
  _undoStack=[];_redoStack=[];_undoEnabled=true;_updateUndoUI();
},100);

// ── wProp : écriture directe d'un param bloc (onchange inline) ────────────
window.wProp = function(bid, key, value){
  const p = pg();
  const b = p ? p.blocks.find(b=>b.id===bid) : null;
  if(!b) return;
  b.params[key] = value;
  if(window._editBlock && window._editBlock.id === bid) window._editBlock.params[key] = value;
  notifyChange(); render();
  if(document.getElementById('block-editor-modal') && window._editBlock && window._editBlock.id===bid)
    window.bemRefreshParams && window.bemRefreshParams(bid);
};

// ── _bemLoadParams : charger les props dans la modale bloc ─────────────────
function _bemLoadParams(b, targetDiv){
  const propsBody = document.getElementById('props-body');
  targetDiv.innerHTML = propsBody
    ? propsBody.innerHTML
    : '<div style="color:#484f58;padding:20px;text-align:center;">Propriétés indisponibles</div>';
  targetDiv.querySelectorAll('[data-key]').forEach(el=>{
    const handler = ()=>{
      const k = el.dataset.key; if(!k) return;
      const val = el.type==='number'||el.type==='range' ? Number(el.value) : el.value;
      b.params[k] = val;
      if(b.type==='CARITHM') updPortsCarithm(b);
      if(b.type==='PYBLOCK')  updPortsPyblock(b);
      notifyChange(); render();
    };
    el.addEventListener('change', handler);
    el.addEventListener('input',  handler);
  });
}

window.bemRefreshParams = function(bid){
  const modal = document.getElementById('block-editor-modal');
  if(!modal || !_editBlock || _editBlock.id !== bid) return;
  const body = document.getElementById('bem-body'); if(!body) return;
  selB = _editBlock; showBlockProps(_editBlock); _bemLoadParams(_editBlock, body);
};

// ── openBlockEditor ────────────────────────────────────────────────────────
let _editBlock = null;
function openBlockEditor(b){
  _editBlock = b;
  const existing = document.getElementById('block-editor-modal');
  if(existing) existing.remove();
  const d = DEFS[b.type]||{};
  const color = d.bdg || '#58a6ff';
  const bgColor = d.hdr || '#161b22';
  const modal = document.createElement('div');
  modal.id = 'block-editor-modal';
  modal.style.cssText = `position:fixed;z-index:7500;left:50%;top:50%;
    transform:translate(-50%,-50%);width:620px;height:640px;min-width:420px;min-height:350px;
    background:#0d1117;border:1.5px solid ${color};border-radius:12px;
    box-shadow:0 16px 64px rgba(0,0,0,0.85);display:flex;flex-direction:column;
    overflow:hidden;resize:both;font-family:'JetBrains Mono',monospace;`;
  const hdr = document.createElement('div');
  hdr.style.cssText = `display:flex;align-items:center;gap:8px;padding:9px 14px;
    background:${bgColor};border-bottom:1px solid ${color}55;flex-shrink:0;cursor:move;user-select:none;`;
  hdr.innerHTML = `<span style="color:${color};font-size:13px;font-weight:700;">${b.type}</span>
    <span id="bem-name" style="color:#e6edf3;font-size:11px;cursor:pointer;padding:2px 6px;
      border:1px solid #30363d;border-radius:4px;">${b.params.name||b.id}</span>
    <div style="flex:1;"></div>
    <button id="bem-apply-btn" style="background:#0a2010;border:1px solid #3fb950;border-radius:5px;
      color:#3fb950;padding:3px 10px;cursor:pointer;font-size:11px;">✓ Appliquer</button>
    <button id="bem-close-btn" style="background:#2a0a0a;border:1px solid #f85149;border-radius:5px;
      color:#f85149;padding:3px 8px;cursor:pointer;font-size:13px;">✕</button>`;
  modal.appendChild(hdr);
  const tabBar = document.createElement('div');
  tabBar.style.cssText = `display:flex;gap:2px;padding:6px 12px 0;
    background:#0d1117;border-bottom:1px solid #21262d;flex-shrink:0;`;
  tabBar.innerHTML = `
    <button id="bem-tab-params" onclick="bemSwitchTab('params')"
      style="padding:5px 14px;border-radius:6px 6px 0 0;border:1px solid ${color};border-bottom:none;
             background:${bgColor};color:${color};font-size:11px;cursor:pointer;">⚙ Paramètres</button>
    <button id="bem-tab-doc" onclick="bemSwitchTab('doc')"
      style="padding:5px 14px;border-radius:6px 6px 0 0;border:1px solid #30363d;border-bottom:none;
             background:#0d1117;color:#8b949e;font-size:11px;cursor:pointer;">📖 Documentation</button>`;
  modal.appendChild(tabBar);
  const body = document.createElement('div');
  body.id = 'bem-body';
  body.style.cssText = `flex:1;overflow-y:auto;padding:12px 14px;background:#0d1117;`;
  selB = b; showBlockProps(b); _bemLoadParams(b, body);
  modal.appendChild(body);
  const footer = document.createElement('div');
  footer.style.cssText = `padding:5px 14px;background:${bgColor};border-top:1px solid ${color}33;
    flex-shrink:0;font-size:9px;color:#484f58;display:flex;gap:12px;align-items:center;`;
  footer.innerHTML = `<span>ID: ${b.id}</span><span>Échap → fermer</span>
    <span style="margin-left:auto;color:#8b949e;">Modifications en temps réel</span>`;
  modal.appendChild(footer);
  document.body.appendChild(modal);
  let _dx=0,_dy=0,_drag=false;
  hdr.addEventListener('mousedown',e=>{
    if(e.target.tagName==='BUTTON'||e.target.id==='bem-name')return;
    _drag=true;const r=modal.getBoundingClientRect();
    _dx=e.clientX-r.left;_dy=e.clientY-r.top;
    modal.style.transform='none';modal.style.left=r.left+'px';modal.style.top=r.top+'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{if(!_drag)return;modal.style.left=(e.clientX-_dx)+'px';modal.style.top=(e.clientY-_dy)+'px';});
  document.addEventListener('mouseup',()=>{_drag=false;});
  document.getElementById('bem-name').addEventListener('click',()=>{
    const n=prompt('Renommer :',b.params.name||b.id);
    if(n&&n.trim()){b.params.name=n.trim();document.getElementById('bem-name').textContent=n.trim();notifyChange();render();}
  });
  document.getElementById('bem-apply-btn').addEventListener('click',()=>{
    notifyChange();render();const btn=document.getElementById('bem-apply-btn');
    btn.textContent='✅ Appliqué!';setTimeout(()=>btn.textContent='✓ Appliquer',1200);
  });
  document.getElementById('bem-close-btn').addEventListener('click',()=>modal.remove());
  const _esc=e=>{if(e.key==='Escape'){modal.remove();document.removeEventListener('keydown',_esc);}};
  document.addEventListener('keydown',_esc);
}

window.bemSwitchTab = function(tab){
  const modal=document.getElementById('block-editor-modal');
  if(!modal||!_editBlock)return;
  const body=document.getElementById('bem-body');
  const d=DEFS[_editBlock.type]||{};
  const color=d.bdg||'#58a6ff',bgColor=d.hdr||'#161b22';
  const btnP=document.getElementById('bem-tab-params');
  const btnD=document.getElementById('bem-tab-doc');
  if(tab==='params'){
    btnP.style.background=bgColor;btnP.style.color=color;btnP.style.borderColor=color;
    btnD.style.background='#0d1117';btnD.style.color='#8b949e';btnD.style.borderColor='#30363d';
    selB=_editBlock;showBlockProps(_editBlock);_bemLoadParams(_editBlock,body);
  } else {
    btnD.style.background=bgColor;btnD.style.color=color;btnD.style.borderColor=color;
    btnP.style.background='#0d1117';btnP.style.color='#8b949e';btnP.style.borderColor='#30363d';
    body.innerHTML=getBlockDoc(_editBlock.type);
  }
};

// ── getBlockDoc ────────────────────────────────────────────────────────────
function getBlockDoc(t){
  const docs = {
    'PLANCHER': '<b style="color:#ff7043">♨ PLANCHER — PID Plancher chauffant</b><br><br>Régule T ambiante par PID. Commande V3V motorisée (V3V_OUV/V3V_FER) + circulateur (CIRC).<br><br><b>Entrées :</b> T_AMB, T_DEP, T_RET, SP (consigne), EN<br><b>Sorties :</b> V3V_OUV, V3V_FER, CIRC, ERR<br><br><b>Sécurités :</b> gel (T&lt;min_temp), surchauffe (T&gt;max_temp), départ (T_DEP&gt;max_depart)',
    'CHAUDIERE':'<b style="color:#ff5252">🔥 CHAUDIERE — Tout/Rien + anti-cyclage</b><br><br>Régulation hystérésis sur T retour. Anti-cyclage min_on/min_off pour chaudière granulés.<br><br><b>Entrées :</b> TEMP_R, TEMP_D, SP, EN<br><b>Sorties :</b> BRULEE, POMPE, ALM',
    'SOLAR':    '<b style="color:#ffd740">☀ SOLAR — ΔT capteur/ballon</b><br><br>Pompe ON si ΔT ≥ ΔT_ON. Priorité ECS puis chauffage. Mode TOR ou analogique 0-10V.<br><br><b>Entrées :</b> T_CAPT, T_BALLON_ECS, T_BALLON_CHAUF, EN<br><b>Sorties :</b> POMPE, VANNE_ECS, VANNE_CHAUF, ALM',
    'ZONE_CHAUF':'<b style="color:#69f0ae">🏠 ZONE_CHAUF — Vanne motorisée</b><br><br>Tout/rien avec hystérésis. Délais open/close pour protection moteur.<br><br><b>Entrées :</b> TEMP, SP, EN<br><b>Sorties :</b> VANNE, ACTIVE',
    'ECS_BLOC': '<b style="color:#40c4ff">🚿 ECS_BLOC — ECS + anti-légionellose</b><br><br>Régulation ballon ECS. Traitement anti-légio hebdomadaire automatique à 65°C.<br><br><b>Entrées :</b> TEMP_ECS, TEMP_PRIM, EN<br><b>Sorties :</b> POMPE, ALM_LEG',
    'PYBLOCK':  '<b style="color:#7c3aed">🐍 PYBLOCK — Code Python natif</b><br><br>Exécute du Python 3 natif avec accès complet au moteur PLC.<br><br><b>Entrées :</b> A1..A4 (float), d1..d4 (bool), I1 (int)<br><b>Sorties :</b> OA1..OA2, od1..od3<br><b>Contexte :</b> dt (s), cycle, state (persistant)<br><b>Helpers :</b> read_analog(ref), read_signal(ref), write_register(ref,v), write_signal(ref,v)<br><b>Libs :</b> math, statistics, datetime',
    'CARITHM':  '<b style="color:#d4c800">💻 CARITHM — Code C embarqué</b><br><br>Syntaxe C simplifiée transpilée en Python. if/else, opérateurs arithmétiques.<br><br><b>Entrées :</b> A1..A8, d1..d7, I1..I2<br><b>Sorties :</b> OA1..OA8, od1..od8, OI1',
  };
  const d=DEFS[t]||{};
  return docs[t]
    ? `<div style="padding:12px;line-height:1.8;font-size:11px;color:#e6edf3;">${docs[t]}</div>`
    : `<div style="padding:20px;text-align:center;color:#484f58;font-size:11px;">${t}<br><br>${d.desc||'Aucune documentation disponible.'}</div>`;
}

// ── updPortsPyblock ────────────────────────────────────────────────────────
function _rewireBlock(b){
  if(!pg()) return;
  pg().wires.forEach(wr=>{
    const sb=pg().blocks.find(bl=>bl.id===wr.src.bid);
    const db=pg().blocks.find(bl=>bl.id===wr.dst.bid);
    if(sb&&db){
      const sp=sb.ports_out.find(p=>p.name===wr.src.port);
      const dp=db.ports_in.find(p=>p.name===wr.dst.port);
      if(sp&&dp){wr.sx=sp.x;wr.sy=sp.y;wr.dx=dp.x;wr.dy=dp.y;}
    }
  });
}

// Repositionne les ports selon b.x/b.y/b.w/b.h SANS recalculer b.h
// Utilisé par le resize pour éviter que updPorts écrase la hauteur manuelle
function _updPortsPos(b){
  // Repositionner les ports existants selon la nouvelle taille
  b.ports_in.forEach((p,i)=>{ p.x=b.x; p.y=b.y+HDR+PTOP+i*PGAP+PGAP/2; });
  b.ports_out.forEach((p,i)=>{ p.x=b.x+b.w; p.y=b.y+HDR+PTOP+i*PGAP+PGAP/2; });
}

function updPortsPyblock(b){
  const p=b.params;
  const na=parseInt(p.n_a)||2,nd=parseInt(p.n_d)||1,ni=parseInt(p.n_i)||0;
  const noa=parseInt(p.n_oa)||1,nod=parseInt(p.n_od)||1,noi=parseInt(p.n_oi)||0;
  const ins=[],outs=[];
  for(let i=1;i<=na;i++) ins.push(`A${i}`);
  for(let i=1;i<=nd;i++) ins.push(`d${i}`);
  for(let i=1;i<=ni;i++) ins.push(`I${i}`);
  for(let i=1;i<=noa;i++) outs.push(`OA${i}`);
  for(let i=1;i<=nod;i++) outs.push(`od${i}`);
  for(let i=1;i<=noi;i++) outs.push(`OI${i}`);
  b.ports_in =ins.map( (n,i)=>({name:n,x:b.x,    y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.ports_out=outs.map((n,i)=>({name:n,x:b.x+b.w,y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.h=HDR+PTOP+Math.max(ins.length,outs.length,1)*PGAP+8;
}

function openCarithmEditor(b){
  _carithmBlock = b;
  let modal = document.getElementById('carithm-modal');
  if(modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'carithm-modal';
  modal.style.cssText = `
    position:fixed; z-index:8000;
    left:50%; top:50%;
    transform:translate(-50%,-50%);
    width:700px; height:520px;
    min-width:400px; min-height:300px;
    background:#0d1117;
    border:1.5px solid #ff4040;
    border-radius:12px;
    box-shadow:0 16px 64px rgba(0,0,0,0.85);
    display:flex; flex-direction:column;
    overflow:hidden; resize:both;
  `;

  // ── Header ──────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.style.cssText = `
    display:flex; align-items:center; gap:8px;
    padding:8px 12px; background:#1a0a0a;
    border-bottom:1px solid #ff404055; flex-shrink:0;
    cursor:move; user-select:none;
  `;
  hdr.innerHTML = `
    <span style="color:#ff6040;font-size:13px;font-weight:700;">📝 CARITHM</span>
    <span id="carithm-modal-name" style="color:#d29922;font-size:11px;font-family:monospace;">${b.params.name||b.id}</span>
    <div style="flex:1;"></div>
    <span style="color:#484f58;font-size:9px;">Double-clic titre pour renommer · ↵ Ctrl+S pour sauver · Échap pour fermer</span>
    <button id="carithm-save-btn" style="background:#1a2f0a;border:1px solid #3fb950;border-radius:5px;color:#3fb950;
      padding:3px 10px;cursor:pointer;font-size:11px;font-family:monospace;">💾 Sauver</button>
    <button id="carithm-close-btn" style="background:#2a0a0a;border:1px solid #f85149;border-radius:5px;
      color:#f85149;padding:3px 8px;cursor:pointer;font-size:13px;">✕</button>
  `;
  modal.appendChild(hdr);

  // ── Barre ports (lecture seule) ──────────────────────────
  const portBar = document.createElement('div');
  portBar.style.cssText = `
    display:flex; gap:12px; flex-wrap:wrap;
    padding:5px 12px; background:#0a0a14;
    border-bottom:1px solid #30363d; flex-shrink:0;
    font:9px 'JetBrains Mono',monospace; color:#484f58;
  `;
  const na=parseInt(b.params.n_a)||2, nd=parseInt(b.params.n_d)||1, ni=parseInt(b.params.n_i)||0;
  const noa=parseInt(b.params.n_oa)||0, nod=parseInt(b.params.n_od)||1, noi=parseInt(b.params.n_oi)||0;
  let portHtml='<span style="color:#58a6ff;">Entrées:</span> ';
  for(let i=1;i<=na;i++) portHtml+=`<span style="color:#58a6ff;">A${i}</span> `;
  for(let i=1;i<=nd;i++) portHtml+=`<span style="color:#3fb950;">d${i}</span> `;
  for(let i=1;i<=ni;i++) portHtml+=`<span style="color:#d29922;">I${i}</span> `;
  portHtml+=' &nbsp; <span style="color:#f0883e;">Sorties:</span> ';
  for(let i=1;i<=noa;i++) portHtml+=`<span style="color:#58a6ff;">OA${i}</span> `;
  for(let i=1;i<=nod;i++) portHtml+=`<span style="color:#3fb950;">od${i}</span> `;
  for(let i=1;i<=noi;i++) portHtml+=`<span style="color:#d29922;">OI${i}</span> `;
  portHtml+='&nbsp;&nbsp;<span style="color:#7c3aed;">Syntaxe C : if/else, float, bool, int, opérateurs +−×÷</span>';
  portBar.innerHTML=portHtml;
  modal.appendChild(portBar);

  // ── Zone code (textarea) ────────────────────────────────
  const codeWrap = document.createElement('div');
  codeWrap.style.cssText='flex:1;display:flex;flex-direction:column;overflow:hidden;';

  // Numéros de lignes + textarea côte à côte
  const codeArea = document.createElement('div');
  codeArea.style.cssText='display:flex;flex:1;overflow:hidden;';

  // Numéros de lignes
  const lineNums = document.createElement('pre');
  lineNums.id='carithm-line-nums';
  lineNums.style.cssText=`
    width:36px; flex-shrink:0;
    background:#0a0a0a; color:#484f58;
    font:12px/1.6 'JetBrains Mono',monospace;
    padding:10px 0; margin:0;
    text-align:right; padding-right:8px;
    border-right:1px solid #21262d;
    overflow:hidden; user-select:none;
  `;

  const ta = document.createElement('textarea');
  ta.id='carithm-code-ta';
  ta.value = b.params.code||'';
  ta.spellcheck=false;
  ta.style.cssText=`
    flex:1; resize:none;
    background:#0d1117; color:#e6edf3;
    border:none; outline:none;
    font:12px/1.6 'JetBrains Mono',monospace;
    padding:10px 12px; tab-size:2;
    caret-color:#58a6ff;
  `;

  // Sync numéros de lignes
  function _syncLineNums(){
    const lines=ta.value.split('\n').length;
    lineNums.textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');
    lineNums.scrollTop=ta.scrollTop;
  }
  ta.addEventListener('input', _syncLineNums);
  ta.addEventListener('scroll',()=>{ lineNums.scrollTop=ta.scrollTop; });

  // Tab → 2 espaces
  ta.addEventListener('keydown',e=>{
    if(e.key==='Tab'){
      e.preventDefault();
      const s=ta.selectionStart, end=ta.selectionEnd;
      ta.value=ta.value.substring(0,s)+'  '+ta.value.substring(end);
      ta.selectionStart=ta.selectionEnd=s+2;
      _syncLineNums();
    }
    if(e.key==='s'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); _saveCarithm(); }
    if(e.key==='Escape'){ e.preventDefault(); modal.remove(); }
  });

  codeArea.appendChild(lineNums);
  codeArea.appendChild(ta);
  codeWrap.appendChild(codeArea);

  // ── Barre status ────────────────────────────────────────
  const statusBar = document.createElement('div');
  statusBar.id='carithm-status';
  statusBar.style.cssText=`
    padding:3px 12px; background:#0a0a14;
    border-top:1px solid #21262d; flex-shrink:0;
    font:9px 'JetBrains Mono',monospace; color:#484f58;
    display:flex; gap:16px;
  `;
  statusBar.innerHTML=`
    <span id="carithm-pos">Ln 1, Col 1</span>
    <span>${b.id}</span>
    <span style="color:#ff4040;">CARITHM</span>
    <span style="margin-left:auto;color:#8b949e;">Redimensionner depuis le coin bas-droit ↘</span>
  `;
  modal.appendChild(codeWrap);
  modal.appendChild(statusBar);

  // Curseur position
  ta.addEventListener('keyup', _updatePos);
  ta.addEventListener('click', _updatePos);
  function _updatePos(){
    const txt=ta.value.substring(0,ta.selectionStart);
    const ln=txt.split('\n').length;
    const col=txt.split('\n').pop().length+1;
    const ps=document.getElementById('carithm-pos');
    if(ps) ps.textContent=`Ln ${ln}, Col ${col}`;
  }

  document.body.appendChild(modal);

  // Init numéros de lignes
  _syncLineNums();

  // Focus textarea
  setTimeout(()=>ta.focus(),50);

  // ── Sauvegarde ──────────────────────────────────────────
  function _saveCarithm(){
    if(!_carithmBlock) return;
    _carithmBlock.params.code = ta.value;
    updPortsCarithm(_carithmBlock);
    notifyChange(); render();
    // Feedback visuel
    const btn=document.getElementById('carithm-save-btn');
    if(btn){ btn.textContent='✅ Sauvé!'; btn.style.color='#3fb950';
      setTimeout(()=>{btn.textContent='💾 Sauver';btn.style.color='#3fb950';},1200); }
    const st=document.getElementById('carithm-status');
    if(st){ const sp=st.querySelector('#carithm-pos');
      if(sp){ const old=sp.textContent; sp.textContent='✅ Code sauvegardé';sp.style.color='#3fb950';
        setTimeout(()=>{sp.textContent=old;sp.style.color='';},1500); } }
  }

  document.getElementById('carithm-save-btn').addEventListener('click', _saveCarithm);
  document.getElementById('carithm-close-btn').addEventListener('click',()=>modal.remove());

  // ── Drag (déplacer la modale) ───────────────────────────
  let _dx=0,_dy=0,_dragging=false;
  hdr.addEventListener('mousedown',e=>{
    if(e.target.tagName==='BUTTON') return;
    _dragging=true;
    const r=modal.getBoundingClientRect();
    _dx=e.clientX-r.left; _dy=e.clientY-r.top;
    modal.style.transform='none';
    modal.style.left=r.left+'px'; modal.style.top=r.top+'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!_dragging) return;
    modal.style.left=(e.clientX-_dx)+'px';
    modal.style.top=(e.clientY-_dy)+'px';
  });
  document.addEventListener('mouseup',()=>{ _dragging=false; });

  // Double-clic sur le titre pour renommer le bloc
  const nameSpan=document.getElementById('carithm-modal-name');
  nameSpan.style.cursor='pointer';
  nameSpan.title='Double-clic pour renommer';
  nameSpan.addEventListener('dblclick',()=>{
    const n=prompt('Nom du bloc CARITHM :',_carithmBlock.params.name||_carithmBlock.id);
    if(n&&n.trim()){
      _carithmBlock.params.name=n.trim();
      nameSpan.textContent=n.trim();
      notifyChange(); render();
    }
  });
}

// ── openPyblockEditor ──────────────────────────────────────────────────────
let _carithmBlock = null;
let _pyblockBlock = null;
let _pyblockCheckTimer = null;
const PYBLOCK_SNIPPETS = [
  {label:'Filtre passe-bas',    code:'tau=30.0\nif \'filt\' not in state:\n    state[\'filt\']=A1\nalpha=dt/(tau+dt)\nstate[\'filt\']=alpha*A1+(1-alpha)*state[\'filt\']\nOA1=state[\'filt\']'},
  {label:'Compteur horaire',    code:'if d2:\n    state[\'h\']=0.0\nelif d1:\n    state.setdefault(\'h\',0.0)\n    state[\'h\']+=dt/3600.0\nOA1=state.get(\'h\',0.0)'},
  {label:'Hystérésis',          code:'err=A1-A2\nif err>A3:\n    state[\'on\']=True\nelif err<-A3:\n    state[\'on\']=False\nod1=state.get(\'on\',False)'},
  {label:'Moyenne glissante',   code:'N=10\nbuf=state.setdefault(\'buf\',[])\nbuf.append(A1)\nif len(buf)>N:buf.pop(0)\nOA1=sum(buf)/len(buf)'},
  {label:'PID simple',          code:'Kp,Ki,Kd=2.0,0.05,0.5\nerr=A2-A1\nstate.setdefault(\'integral\',0.0)\nstate.setdefault(\'prev_err\',0.0)\nstate[\'integral\']=max(-100,min(100,state[\'integral\']+Ki*err*dt))\nderiv=Kd*(err-state[\'prev_err\'])/max(dt,0.001)\nOA1=max(0.0,min(100.0,Kp*err+state[\'integral\']+deriv))\nstate[\'prev_err\']=err'},
  {label:'Loi d\'eau',          code:'ratio=max(0.0,min(1.0,(A1-(-10.0))/(15.0-(-10.0))))\nOA1=65.0-ratio*(65.0-35.0)\nOA1+=( 20.0-A2)*2.0\nOA1=max(25.0,min(75.0,OA1))'},
];

function openPyblockEditor(b){
  _pyblockBlock=b;
  const ex=document.getElementById('pyblock-modal');if(ex)ex.remove();
  const p=b.params;
  const na=parseInt(p.n_a)||2,nd=parseInt(p.n_d)||1,ni=parseInt(p.n_i)||0;
  const noa=parseInt(p.n_oa)||1,nod=parseInt(p.n_od)||1,noi=parseInt(p.n_oi)||0;
  const modal=document.createElement('div');
  modal.id='pyblock-modal';
  modal.style.cssText='position:fixed;z-index:8000;left:50%;top:50%;transform:translate(-50%,-50%);width:820px;height:640px;min-width:540px;min-height:380px;background:#0d1117;border:1.5px solid #7c3aed;border-radius:12px;box-shadow:0 16px 64px rgba(0,0,0,0.85);display:flex;flex-direction:column;overflow:hidden;resize:both;';
  const hdr=document.createElement('div');
  hdr.style.cssText='display:flex;align-items:center;gap:8px;padding:8px 12px;background:#10102a;border-bottom:1px solid #7c3aed55;flex-shrink:0;cursor:move;user-select:none;';
  hdr.innerHTML=`<span style="font-size:15px;">🐍</span><span style="color:#7c3aed;font-size:13px;font-weight:700;">PYBLOCK</span>
    <span id="pyb-name" style="color:#e6edf3;font-size:11px;cursor:pointer;padding:2px 6px;border:1px solid #30363d;border-radius:4px;">${p.name||b.id}</span>
    <div style="flex:1;"></div>
    <button id="pyb-snippet-btn" style="background:#1a0a35;border:1px solid #7c3aed;border-radius:5px;color:#bc8cff;padding:3px 8px;cursor:pointer;font-size:11px;">📋 Snippets</button>
    <button id="pyb-check-btn" style="background:#0a1a35;border:1px solid #58a6ff;border-radius:5px;color:#58a6ff;padding:3px 8px;cursor:pointer;font-size:11px;">🔍 Vérifier</button>
    <button id="pyb-run-btn" style="background:#031a0a;border:1px solid #3fb950;border-radius:5px;color:#3fb950;padding:3px 8px;cursor:pointer;font-size:11px;">▶ Tester</button>
    <button id="pyb-save" style="background:#1a0a35;border:1px solid #7c3aed;border-radius:5px;color:#bc8cff;padding:3px 10px;cursor:pointer;font-size:11px;">💾 Sauver</button>
    <button id="pyb-close" style="background:#2a0a0a;border:1px solid #f85149;border-radius:5px;color:#f85149;padding:3px 8px;cursor:pointer;font-size:13px;">✕</button>`;
  modal.appendChild(hdr);
  // Barre variables
  const varBar=document.createElement('div');
  varBar.style.cssText='display:flex;flex-wrap:wrap;gap:5px;padding:5px 12px;background:#0a0a18;border-bottom:1px solid #21262d;flex-shrink:0;font-size:9px;';
  let vHtml='<span style="color:#484f58;">IN:</span> ';
  for(let i=1;i<=na;i++) vHtml+=`<code style="color:#58a6ff;background:#0d1f35;padding:1px 4px;border-radius:3px;cursor:pointer;" onclick="_pybInsert('A${i}')">A${i}</code> `;
  for(let i=1;i<=nd;i++) vHtml+=`<code style="color:#3fb950;background:#031a0a;padding:1px 4px;border-radius:3px;cursor:pointer;" onclick="_pybInsert('d${i}')">d${i}</code> `;
  vHtml+=' <span style="color:#484f58;">OUT:</span> ';
  for(let i=1;i<=noa;i++) vHtml+=`<code style="color:#58a6ff;background:#0d1f35;padding:1px 4px;border-radius:3px;cursor:pointer;" onclick="_pybInsert('OA${i}')">OA${i}</code> `;
  for(let i=1;i<=nod;i++) vHtml+=`<code style="color:#3fb950;background:#031a0a;padding:1px 4px;border-radius:3px;cursor:pointer;" onclick="_pybInsert('od${i}')">od${i}</code> `;
  vHtml+=' <span style="color:#484f58;">CTX:</span> ';
  ['dt','cycle','state','read_analog(','read_signal(','write_register(','write_signal('].forEach(v=>{
    vHtml+=`<code style="color:#bc8cff;background:#1a0a35;padding:1px 4px;border-radius:3px;cursor:pointer;" onclick="_pybInsert('${v}')">${v}</code> `;
  });
  varBar.innerHTML=vHtml;
  modal.appendChild(varBar);
  // Zone éditeur + résultats
  const mainArea=document.createElement('div');mainArea.style.cssText='display:flex;flex:1;overflow:hidden;';
  const edPane=document.createElement('div');edPane.style.cssText='display:flex;flex:1;overflow:hidden;flex-direction:column;';
  const codeArea=document.createElement('div');codeArea.style.cssText='display:flex;flex:1;overflow:hidden;';
  const lineNums=document.createElement('pre');lineNums.id='pyb-lines';
  lineNums.style.cssText='width:38px;flex-shrink:0;background:#0a0a18;color:#484f58;font:12px/1.6 monospace;padding:10px 0;margin:0;text-align:right;padding-right:8px;border-right:1px solid #21262d;overflow:hidden;user-select:none;';
  const ta=document.createElement('textarea');ta.id='pyb-code';
  ta.value=p.code||'# Code Python ici\n';ta.spellcheck=false;
  ta.style.cssText='flex:1;resize:none;background:#0d1117;color:#e6edf3;border:none;outline:none;font:12px/1.6 monospace;padding:10px 12px;tab-size:4;caret-color:#bc8cff;';
  function _syncLines(){const n=ta.value.split('\n').length;lineNums.textContent=Array.from({length:n},(_,i)=>i+1).join('\n');lineNums.scrollTop=ta.scrollTop;}
  ta.addEventListener('input',_syncLines);ta.addEventListener('scroll',()=>{lineNums.scrollTop=ta.scrollTop;});
  codeArea.appendChild(lineNums);codeArea.appendChild(ta);edPane.appendChild(codeArea);
  const sb=document.createElement('div');sb.id='pyb-status';
  sb.style.cssText='padding:3px 12px;background:#0a0a18;border-top:1px solid #21262d;flex-shrink:0;font:9px monospace;color:#484f58;display:flex;gap:12px;min-height:22px;';
  sb.innerHTML='<span id="pyb-pos">Ln 1, Col 1</span><span id="pyb-err-msg" style="color:#f85149;"></span><span style="margin-left:auto;color:#3fb950;" id="pyb-ok-msg"></span>';
  edPane.appendChild(sb);mainArea.appendChild(edPane);
  const resPane=document.createElement('div');resPane.id='pyb-results';
  resPane.style.cssText='width:220px;flex-shrink:0;background:#0a0a1a;border-left:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden;';
  resPane.innerHTML='<div style="padding:6px 10px;background:#10102a;border-bottom:1px solid #21262d;font-size:10px;color:#7c3aed;font-weight:700;flex-shrink:0;">📊 Résultats</div><div id="pyb-result-body" style="flex:1;overflow-y:auto;padding:8px 10px;font:10px monospace;color:#8b949e;line-height:1.7;"><span style="color:#484f58;">Cliquer ▶ Tester</span></div>';
  mainArea.appendChild(resPane);modal.appendChild(mainArea);
  document.body.appendChild(modal);
  _syncLines();setTimeout(()=>ta.focus(),50);
  ta.addEventListener('keyup',()=>{const txt=ta.value.substring(0,ta.selectionStart);const ln=txt.split('\n').length,col=txt.split('\n').pop().length+1;const ps=document.getElementById('pyb-pos');if(ps)ps.textContent=`Ln ${ln}, Col ${col}`;});
  function _clearErr(){const em=document.getElementById('pyb-err-msg');const ok=document.getElementById('pyb-ok-msg');if(em)em.textContent='';if(ok)ok.textContent='';}
  function _showErr(line,msg){const em=document.getElementById('pyb-err-msg');if(em)em.textContent=`⚠ L${line}: ${msg}`;}
  function _showOk(msg){const ok=document.getElementById('pyb-ok-msg');if(ok)ok.textContent=msg||'✓ OK';}
  function _checkSyntax(){
    if(!window.pybridge||!window.pybridge.check_pyblock_syntax){setTimeout(_checkSyntax,600);return;}
    try{window.pybridge.check_pyblock_syntax(ta.value,function(result){
      try{const r=JSON.parse(result);_clearErr();
        if(r.ok){if(r.warnings&&r.warnings.length)_showErr(r.warnings[0].line,'⚠ '+r.warnings[0].msg);else _showOk('✓ Syntaxe OK');}
        else _showErr(r.line||1,r.msg);
      }catch(pe){}
    });}catch(e){}
  }
  ta.addEventListener('input',()=>{_syncLines();clearTimeout(_pyblockCheckTimer);_pyblockCheckTimer=setTimeout(_checkSyntax,400);});
  ta.addEventListener('keydown',e=>{
    if(e.key==='Tab'){e.preventDefault();const s=ta.selectionStart;ta.value=ta.value.substring(0,s)+'    '+ta.value.substring(ta.selectionEnd);ta.selectionStart=ta.selectionEnd=s+4;_syncLines();}
    if(e.key==='s'&&(e.ctrlKey||e.metaKey)){e.preventDefault();_savePyblock();}
    if(e.key==='Escape'){e.preventDefault();modal.remove();}
    const pairs={'(':')','{':'}','[':']',"'":"'",'"':'"'};
    if(pairs[e.key]&&!e.ctrlKey&&!e.altKey){const s2=ta.selectionStart;if(!ta.value.substring(s2,ta.selectionEnd)){e.preventDefault();ta.value=ta.value.substring(0,s2)+e.key+pairs[e.key]+ta.value.substring(s2);ta.selectionStart=ta.selectionEnd=s2+1;_syncLines();}}
  });
  function _runTest(){
    const btn=document.getElementById('pyb-run-btn');const body=document.getElementById('pyb-result-body');
    if(btn){btn.disabled=true;btn.textContent='⏳ ...';}
    if(!window.pybridge||!window.pybridge.run_pyblock_test){
      if(body)body.innerHTML='<span style="color:#d29922;">⏳ Connexion moteur…</span>';
      setTimeout(()=>{if(btn){btn.disabled=false;btn.textContent='▶ Tester';}_runTest();},800);return;
    }
    try{window.pybridge.run_pyblock_test(ta.value,na,nd,function(result){
      try{const r=JSON.parse(result);if(btn){btn.disabled=false;btn.textContent='▶ Tester';}_clearErr();
        if(!r.ok){_showErr(r.line||1,r.error);if(body)body.innerHTML=`<div style="color:#f85149;">✗ L${r.line||'?'}: ${r.error}</div>`;}
        else{_showOk('✓ OK');let html='<div style="color:#3fb950;margin-bottom:6px;">✓ OK</div>';
          if(Object.keys(r.outputs).length){html+='<div style="color:#d29922;margin-bottom:3px;">Sorties:</div>';for(const[k,v]of Object.entries(r.outputs)){const col=k.startsWith('OA')||k==='OI1'?'#58a6ff':'#3fb950';html+=`<div><code style="color:${col};">${k}</code>=<b style="color:#e6edf3;">${v}</b></div>`;}}
          if(r.print&&r.print.length){html+='<div style="color:#d29922;margin-top:4px;">print:</div>';html+=r.print.map(l=>`<div style="color:#e6edf3;">${l}</div>`).join('');}
          if(body)body.innerHTML=html;}
      }catch(pe){if(btn){btn.disabled=false;btn.textContent='▶ Tester';}}
    });}catch(e2){if(btn){btn.disabled=false;btn.textContent='▶ Tester';}}
  }
  function _showSnippets(){
    const ex=document.getElementById('pyb-snippet-menu');if(ex){ex.remove();return;}
    const br=document.getElementById('pyb-snippet-btn').getBoundingClientRect();
    const menu=document.createElement('div');menu.id='pyb-snippet-menu';
    menu.style.cssText=`position:fixed;left:${br.left}px;top:${br.bottom+4}px;z-index:9999;background:#161b22;border:1px solid #7c3aed;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.8);min-width:180px;overflow:hidden;`;
    PYBLOCK_SNIPPETS.forEach(s=>{const it=document.createElement('div');it.style.cssText='padding:7px 14px;cursor:pointer;font:11px monospace;color:#e6edf3;';it.textContent=s.label;it.addEventListener('mouseenter',()=>it.style.background='#2a1050');it.addEventListener('mouseleave',()=>it.style.background='');it.addEventListener('click',()=>{const pos=ta.selectionStart;const pre=ta.value.substring(0,pos);const suf=ta.value.substring(pos);const sep=pre&&!pre.endsWith('\n')?'\n':'';ta.value=pre+sep+s.code+'\n'+suf;ta.selectionStart=ta.selectionEnd=pos+sep.length+s.code.length+1;ta.focus();_syncLines();menu.remove();});menu.appendChild(it);});
    document.body.appendChild(menu);
    setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),50);
  }
  window._pybInsert=function(text){const pos=ta.selectionStart;ta.value=ta.value.substring(0,pos)+text+ta.value.substring(pos);ta.selectionStart=ta.selectionEnd=pos+text.length;ta.focus();_syncLines();};
  function _savePyblock(){if(!_pyblockBlock)return;_pyblockBlock.params.code=ta.value;updPortsPyblock(_pyblockBlock);notifyChange();render();const btn=document.getElementById('pyb-save');if(btn){btn.textContent='✅ Sauvé!';setTimeout(()=>btn.textContent='💾 Sauver',1500);}  _showOk('✓ Sauvegardé');}
  document.getElementById('pyb-save').addEventListener('click',_savePyblock);
  document.getElementById('pyb-close').addEventListener('click',()=>modal.remove());
  document.getElementById('pyb-check-btn').addEventListener('click',_checkSyntax);
  document.getElementById('pyb-run-btn').addEventListener('click',_runTest);
  document.getElementById('pyb-snippet-btn').addEventListener('click',_showSnippets);
  document.getElementById('pyb-name').addEventListener('click',()=>{const n=prompt('Nom :',_pyblockBlock.params.name||_pyblockBlock.id);if(n&&n.trim()){_pyblockBlock.params.name=n.trim();document.getElementById('pyb-name').textContent=n.trim();notifyChange();render();}});
  let _dx2=0,_dy2=0,_drag2=false;
  hdr.addEventListener('mousedown',e=>{if(e.target.tagName==='BUTTON'||e.target.id==='pyb-name')return;_drag2=true;const r=modal.getBoundingClientRect();_dx2=e.clientX-r.left;_dy2=e.clientY-r.top;modal.style.transform='none';modal.style.left=r.left+'px';modal.style.top=r.top+'px';e.preventDefault();});
  document.addEventListener('mousemove',e=>{if(!_drag2)return;modal.style.left=(e.clientX-_dx2)+'px';modal.style.top=(e.clientY-_dy2)+'px';});
  document.addEventListener('mouseup',()=>{_drag2=false;});
  const _esc2=e=>{if(e.key==='Escape'){modal.remove();document.removeEventListener('keydown',_esc2);}};
  document.addEventListener('keydown',_esc2);
  setTimeout(_checkSyntax,600);
}

// ── Recherche Ctrl+F ───────────────────────────────────────────────────────
let _searchResults=[];let _searchCursor=-1;
function _fbdSearchOpen(){const bar=document.getElementById('fbd-search-bar');if(!bar)return;bar.style.display='flex';const inp=document.getElementById('fbd-search-input');if(inp){inp.focus();inp.select();}}
function _fbdSearchClose(){const bar=document.getElementById('fbd-search-bar');if(bar)bar.style.display='none';_searchResults=[];_searchCursor=-1;selB=null;render();const cnt=document.getElementById('fbd-search-count');if(cnt)cnt.textContent='';}
function _fbdSearch(query){
  _searchResults=[];_searchCursor=-1;
  if(!query.trim()){render();return;}
  const q=query.toLowerCase().trim();
  pages.forEach((p,pi)=>{p.blocks.forEach(b=>{
    const name=(b.params?.name||'').toLowerCase(),type=b.type.toLowerCase(),id=b.id.toLowerCase();
    const code=(b.params?.code||'').toLowerCase(),label=(b.params?.varname||b.params?.signal||'').toLowerCase();
    if(name.includes(q)||type.includes(q)||id.includes(q)||code.includes(q)||label.includes(q))
      _searchResults.push({pageIdx:pi,block:b});
  });});
  const cnt=document.getElementById('fbd-search-count');
  if(!_searchResults.length){if(cnt){cnt.textContent='0 résultat';cnt.style.color='#f85149';}selB=null;render();}
  else{if(cnt){cnt.style.color='#8b949e';}_searchCursor=0;_fbdSearchGoto(0);}
}
function _fbdSearchNext(){if(!_searchResults.length)return;_searchCursor=(_searchCursor+1)%_searchResults.length;_fbdSearchGoto(_searchCursor);}
function _fbdSearchPrev(){if(!_searchResults.length)return;_searchCursor=(_searchCursor-1+_searchResults.length)%_searchResults.length;_fbdSearchGoto(_searchCursor);}
function _fbdSearchGoto(idx){
  const r=_searchResults[idx];if(!r)return;
  if(r.pageIdx!==cur)goPage(r.pageIdx);
  selB=r.block;showBlockProps(r.block);
  const bx=r.block.x+r.block.w/2,by=r.block.y+r.block.h/2;
  vp.x=cvs.width/2/vp.scale-bx;vp.y=cvs.height/2/vp.scale-by;
  render();
  const cnt=document.getElementById('fbd-search-count');if(cnt)cnt.textContent=`${idx+1}/${_searchResults.length}`;
}
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();_fbdSearchOpen();}
  if(e.key==='F3'){e.preventDefault();_fbdSearchNext();}
});

// ── Trend temps réel ───────────────────────────────────────────────────────
const _trendBuffers={};const TREND_MAX=60;let _trendVisible=false;
function _trendToggle(){
  _trendVisible=!_trendVisible;
  const btn=document.getElementById('trend-toggle-btn');
  if(btn){btn.style.background=_trendVisible?'#1a2f0a':'#161b22';btn.style.borderColor=_trendVisible?'#3fb950':'#30363d';btn.style.color=_trendVisible?'#3fb950':'#8b949e';btn.textContent=_trendVisible?'📈 Trend ON':'📈 Trend';}
  render();
}
function _trendUpdate(state){
  if(!state||!_trendVisible)return;
  const all={...(state.registers||{}),...(state.analog||{})};
  for(const[ref,val]of Object.entries(all)){let v=typeof val==='object'?val.celsius:parseFloat(val);if(isNaN(v))continue;if(!_trendBuffers[ref])_trendBuffers[ref]=[];_trendBuffers[ref].push(v);if(_trendBuffers[ref].length>TREND_MAX)_trendBuffers[ref].shift();}
}
function _drawTrend(b){
  if(!_trendVisible)return;
  const ref=b.params?.reg_out||b.params?.analog_ref||b.params?.varname;if(!ref)return;
  const buf=_trendBuffers[ref];if(!buf||buf.length<2)return;
  const TW=b.w,TH=28,tx=b.x,ty=b.y+b.h+2;
  const mn=Math.min(...buf),mx=Math.max(...buf),sp=mx-mn||1;
  ctx.fillStyle='#0a1a0a';ctx.fillRect(tx,ty,TW,TH);
  ctx.strokeStyle='#21262d';ctx.lineWidth=0.5/vp.scale;ctx.strokeRect(tx,ty,TW,TH);
  ctx.strokeStyle='#3fb950';ctx.lineWidth=1/vp.scale;ctx.lineJoin='round';ctx.beginPath();
  buf.forEach((v,i)=>{const px=tx+(i/(TREND_MAX-1))*TW;const py=ty+TH-((v-mn)/sp)*(TH-4)-2;i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);});ctx.stroke();
  ctx.fillStyle='#3fb950';ctx.font=`bold ${9/vp.scale}px monospace`;ctx.textAlign='right';ctx.textBaseline='top';ctx.fillText(buf[buf.length-1].toFixed(1),tx+TW-2,ty+1);
}

// F1 → ouvrir documentation
document.addEventListener('keydown',e=>{
  if(e.key==='F1'){e.preventDefault();if(window.pybridge&&window.pybridge.open_doc)window.pybridge.open_doc('');}
});


