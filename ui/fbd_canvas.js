

// ════════════════════════════════════════════════════════════
// COMPILATEUR DE FILS — Auto-assignation des registres RF
// ════════════════════════════════════════════════════════════
//
// Quand un fil est tracé entre deux ports, un registre RF est
// automatiquement assigné dans les params du bloc source (ex: reg_out)
// et du bloc destination (ex: reg_a / a1_ref / d1_ref…).
// Le serveur n'a plus besoin de deviner les connexions : flatten_blocks
// lit directement ces params pour exécuter le programme.
//
// Convention :
//   RF100..RF999  réservés au compilateur de fils (auto-wire)
//   RF0..RF99     libres pour usage manuel dans les params

let _rfAuto = 100; // prochain registre disponible

/** Renvoie un nouveau registre RF unique pour le compilateur de fils. */
function _nextRF(){
  return `RF${_rfAuto++}`;
}

/**
 * Initialise _rfAuto en scannant tous les registres RF>=100 déjà utilisés
 * dans le diagramme, pour éviter les collisions après un rechargement.
 */
function _initRFCounter(diagram){
  let maxRF = 99;
  (diagram.pages||[]).forEach(pg=>{
    (pg.blocks||[]).forEach(b=>{
      Object.values(b.params||{}).forEach(v=>{
        if(typeof v==='string' && v.startsWith('RF')){
          const n=parseInt(v.slice(2));
          if(!isNaN(n) && n>maxRF) maxRF=n;
        }
      });
    });
  });
  _rfAuto = maxRF + 1;
}

/**
 * Retourne le nom du param params[] côté SOURCE pour un port donné.
 *   ex: port='VAL' → 'reg_out'
 *       port='OA1' → 'oa1_ref'
 *       port='od2' → 'od2_ref'
 */
function _srcParamKey(btype, port){
  const p = port.toLowerCase();
  if(['val','out','sig','sts','q'].includes(p))        return 'reg_out';
  if(p==='hour')                                       return 'reg_hour';
  if(p==='wday' || p==='mday')                         return 'reg_wday';
  const oaM = p.match(/^oa(\d+)$/);  if(oaM) return `oa${oaM[1]}_ref`;
  const odM = p.match(/^od(\d+)$/);  if(odM) return `od${odM[1]}_ref`;
  // RUNTIMCNT sorties
  if(p==='starts')   return 'reg_starts';
  if(p==='total')    return 'reg_total';
  if(p==='runtime')  return 'reg_runtime';
  // Valeur générique
  return 'reg_out';
}

/**
 * Retourne le nom du param params[] côté DESTINATION pour un port donné.
 *   ex: port='IN1' → 'reg_a'
 *       port='A3'  → 'a3_ref'
 *       port='d2'  → 'd2_ref'
 */
function _dstParamKey(btype, port){
  const p = port.toLowerCase();
  const bt = (btype||'').toLowerCase();
  if(p==='in' && (bt==='conn'||bt==='conn_tx'||bt==='conn_rx')) return 'reg_in';
  if(p==='in1' || p==='in')                         return 'reg_a';
  if(p==='in2')                                     return 'reg_b';
  if(p==='sig' && bt==='page_out')                  return 'reg_in';
  if(p==='val' && ['output','backup'].includes(bt)) return 'val_ref';
  if(p==='val')                                     return 'reg_a';
  // Bobines / conditions booléennes
  if(p==='run'  || p==='en')  return 'condition';
  if(p==='rst'  || p==='res') return 'reset_condition';
  if(p==='set'  || p==='s')   return 'set_cond';
  if(p==='r')                 return 'res_cond';
  // RUNTIMCNT
  if(p==='run')  return 'condition';
  if(p==='rst')  return 'reset_condition';
  // PYBLOCK / CARITHM : A1..A9, d1..d9, I1..I2
  const aM = p.match(/^a(\d+)$/);   if(aM) return `a${aM[1]}_ref`;
  const dM = p.match(/^d(\d+)$/);   if(dM) return `d${dM[1]}_ref`;
  const iM = p.match(/^i(\d+)$/);   if(iM) return `i${iM[1]}_ref`;
  // Entrée générique
  return 'reg_a';
}

/**
 * Assigne un registre RF à un fil src→dst dans les params des blocs.
 * Si le port source a déjà un RF auto-assigné (fan-out), le réutilise.
 * Retourne le RF assigné.
 */
function _assignWireRF(p, sBid, sPort, dBid, dPort){
  const sb = p.blocks.find(b=>b.id===sBid);
  const db = p.blocks.find(b=>b.id===dBid);
  if(!sb||!db) return null;

  const srcKey = _srcParamKey(sb.type, sPort);
  const dstKey = _dstParamKey(db.type, dPort);

  // ── Fan-out standard : réutiliser le RF déjà assigné à la source ──────────
  let rf = sb.params[srcKey];
  if(!rf || typeof rf!=='string' || !rf.startsWith('RF') || parseInt(rf.slice(2))<100){

    // ── Cas CONN* (port OUT) : propager le RF du partenaire TX → RX ───────
    // Quand on relie CONN_RX.OUT→B (ou CONN.OUT→B), chercher le RF du
    // partenaire (CONN_TX ou l'autre CONN de même num) déjà alimenté.
    let rfFromPartner = null;
    if(srcKey === 'reg_out' && (sb.type==='CONN'||sb.type==='CONN_RX')){
      const myNum = String(sb.params.num || '');
      const partner = p.blocks.find(x=>
        x.id !== sb.id &&
        (x.type==='CONN'||x.type==='CONN_TX') &&
        String(x.params.num||'') === myNum &&
        x.params.reg_in && x.params.reg_in.startsWith('RF') && parseInt(x.params.reg_in.slice(2))>=100
      );
      if(partner) rfFromPartner = partner.params.reg_in;
    }

    rf = rfFromPartner || _nextRF();
    if(srcKey) sb.params[srcKey] = rf;
  }
  if(dstKey) db.params[dstKey] = rf;
  return rf;
}

/**
 * Libère le param RF d'un bloc destination quand son fil est supprimé.
 * Si le port source n'alimente plus aucun autre fil, nettoie aussi le src.
 */
function _releaseWireRF(p, w){
  const sb = p.blocks.find(b=>b.id===w.src.bid);
  const db = p.blocks.find(b=>b.id===w.dst.bid);
  if(!sb||!db) return;

  const dstKey = _dstParamKey(db.type, w.dst.port);
  if(dstKey) delete db.params[dstKey];

  // Nettoyer le src seulement si aucun autre fil ne part du même port
  const srcKey = _srcParamKey(sb.type, w.src.port);
  const stillUsed = p.wires.some(
    x=>x!==w && x.src.bid===w.src.bid && x.src.port===w.src.port
  );
  if(!stillUsed && srcKey) delete sb.params[srcKey];
}

// ════════════════════════════════════════════════════════════
// DÉFINITIONS
// ════════════════════════════════════════════════════════════
const DEFS = {
  // E/S
  INPUT:    {cat:'E/S',        col:'#0d1f35',hdr:'#1a2f45',bdg:'#58a6ff',ins:[],           outs:['VAL'],    desc:'Entrée GPIO'},
  OUTPUT:   {cat:'E/S',        col:'#1f2d0d',hdr:'#2a3d10',bdg:'#3fb950',ins:['VAL'],       outs:[],         desc:'Sortie GPIO'},
  CONST:    {cat:'E/S',        col:'#2a1f0a',hdr:'#352810',bdg:'#d29922',ins:[],            outs:['VAL'],    desc:'Constante'},
  MEM:      {cat:'E/S',        col:'#1a1a2a',hdr:'#252535',bdg:'#bc8cff',ins:['W'],         outs:['R'],      desc:'Bit mémoire'},
  // Zone cartouche (cadre dessin imprimable)
  CARTOUCHE:{cat:'Cartouche', col:'#12192a',hdr:'#1a2540',bdg:'#c9d1d9',ins:[],           outs:[],         desc:'Zone cartouche (cadre impression)'},
  CONN:     {cat:'Connecteurs',col:'#0a1a2a',hdr:'#102030',bdg:'#58a6ff',ins:['IN'],        outs:['OUT'],    desc:'Connecteur numéroté'},
  CONN_TX:  {cat:'Connecteurs',col:'#1a0a2a',hdr:'#2a1040',bdg:'#f0883e',ins:['IN'],        outs:[],         desc:'Connecteur émetteur (envoi)'},
  CONN_RX:  {cat:'Connecteurs',col:'#0a1a1a',hdr:'#102828',bdg:'#39d3b0',ins:[],            outs:['OUT'],    desc:'Connecteur récepteur (réception)'},
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
  DS_IN:    {cat:'Analogique', col:'#0a2a1f',hdr:'#0f3527',bdg:'#00ffa0',ins:[],            outs:['TEMP'],       desc:'Sonde DS18B20 (1-Wire)'},
  COMPARE_F:{cat:'Analogique', col:'#2a1f0a',hdr:'#352810',bdg:'#ffaa00',ins:['IN','SP'],   outs:['GT','LT','EQ'],desc:'Comparaison flottante'},
  SCALE:    {cat:'Analogique', col:'#1a2a1a',hdr:'#203520',bdg:'#80ff80',ins:['IN'],        outs:['OUT'],        desc:'Mise à l\'échelle'},
  PID:      {cat:'Analogique', col:'#1a0a2a',hdr:'#250f35',bdg:'#d080ff',ins:['PV','SP','EN'],outs:['OUT','ERR'], desc:'Régulateur PID'},
  // Analogique avancé (Proview)
  SENSOR:   {cat:'Analogique', col:'#0a2020',hdr:'#103030',bdg:'#00ffe0',ins:[],            outs:['VAL'],        desc:'Capteur temperature (SensorFo)'},
  MQTT:     {cat:'Analogique', col:'#0a1a2a',hdr:'#0d2340',bdg:'#58a6ff',ins:['PUB'],       outs:['SUB'],        desc:'Bloc MQTT — subscribe (lecture) et/ou publish (ecriture)'},
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
  NAND:     {cat:'Logique',    col:'#1f3a5f',hdr:'#2a4a70',bdg:'#ff6060',ins:['IN1','IN2'],outs:['OUT'],         desc:'NON ET (NAND)'},
  NOR:      {cat:'Logique',    col:'#1f3a5f',hdr:'#2a4a70',bdg:'#ff9040',ins:['IN1','IN2'],outs:['OUT'],         desc:'NON OU (NOR)'},
  BOOLEAN:  {cat:'Logique',    col:'#0a1a35',hdr:'#102040',bdg:'#60c0ff',ins:['I1','I2','I3','I4'],outs:['O1','O2'],       desc:'Table de vérité booléenne (1-6 entrées, 1-2 sorties)'},
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
  PROG_H:     {cat:'Métier', col:'#1a1000',hdr:'#2a1a00',bdg:'#ffb300',
               ins:['EN','VAC'],
               outs:['JOUR','SP_ACT','VAC_OUT'],
               desc:'Programmation horaire Jour/Nuit — consigne adaptative + mode vacances'},

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
const DS_REFS   = Array.from({length:8},(_,i)=>`DS${i}`);   // DS0..DS7 (cf core/plc_engine.py + rpi_server/server.py)
const REG_REFS  = Array.from({length:256},(_,i)=>`RF${i}`);  // RF0..RF255 (RF0..RF99 manuels, RF100+ compilateur de fils)
const PT_TYPES  = [{v:'pt100',l:'PT100 (100Ω)'},{v:'pt1000',l:'PT1000 (1kΩ)'}];
const ADS_CH    = [{v:0,l:'CH0'},{v:1,l:'CH1'},{v:2,l:'CH2'},{v:3,l:'CH3'}];
const SPI_CH    = [{v:0,l:'SPI CE0'},{v:1,l:'SPI CE1'},{v:2,l:'SPI CE2'},{v:3,l:'SPI CE3'}];

// ── Config sondes analogiques (poussée depuis Python via setAnalogConfig) ──
window._analogCfg = {};

/** Construit la liste d'options pour le dropdown "Entrée analogique" du bloc SENSOR.
 *  Utilise les noms configurés dans _analogCfg si disponibles,
 *  sinon retourne les libellés génériques ANA0..ANA11. */
function _anaOptions() {
  const opts = [];
  const ads = (window._analogCfg && window._analogCfg.ads) || [];
  if (ads.length) {
    ads.forEach(module => {
      (module.channels || []).forEach(ch => {
        const label = ch.name && ch.name.trim()
          ? `${ch.id} — ${ch.name}`
          : `${ch.id} — Sonde`;
        opts.push({v: ch.id, l: label});
      });
    });
  }
  // Fallback : 12 canaux génériques si la config n'est pas encore chargée
  if (!opts.length) {
    for (let i = 0; i < 12; i++) opts.push({v:`ANA${i}`, l:`ANA${i} — Sonde ${i+1}`});
  }
  return opts;
}

/** Appelée depuis Python (block_editor.py → set_analog_config) après validation
 *  du dialogue "Configuration des sondes analogiques". */
window.setAnalogConfig = function(cfg) {
  window._analogCfg = cfg || {};
  // Si le panneau de propriétés affiche un bloc SENSOR, le rafraîchir
  if (typeof selB !== 'undefined' && selB && selB.type === 'SENSOR') {
    showBlockProps(selB);
  }
};

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
  // Canvas infini : une seule page logique ; addPage conservé
  // pour compatibilité ascendante mais ne crée qu'une page si vide.
  if(pages.length>0) return; // déjà une page : rien faire
  const id=`P${idCtr++}`;
  pages.push({id,name:name||'Programme',blocks:[],wires:[]});
  pgVP[id]={x:40,y:40,scale:1};
  cur=0; updateNav(); drawGrid(); render();
}

function goPage(idx){
  if(idx<0||idx>=pages.length)return;
  if(pages[cur]) pgVP[pages[cur].id]={...vp};
  cur=idx;
  const sv=pgVP[pages[cur].id];
  vp.x=sv.x;vp.y=sv.y;vp.scale=sv.scale;
  selB=null;selW=null;showEmptyProps();
  updateNav(); drawGrid(); render();
  // FIX: si la page n'a jamais été vue (viewport par défaut scale=1, x=40),
  // ajuster automatiquement la vue pour afficher tous les blocs
  if(sv.scale===1 && sv.x===40 && sv.y===40 && pages[cur].blocks.length){
    fitView();
  }
}

function updateNav(){
  // Canvas infini : pas de navigation multi-pages
  // Les éléments nav-prev/next sont masqués dans le HTML
  const badge = document.getElementById('nav-crosspage-badge');
  if(badge) badge.style.display='none';
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

// Canvas infini : boutons nav-pages masqués dans le HTML — pas d'event listeners nécessaires

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

// ═══════════════════════════════════════════════════════════════════════
// Auto-nommage unique : evite toute collision sur TOUTES les pages
// ═══════════════════════════════════════════════════════════════════════

const _UNIQUE_VARNAME = new Set(['BACKUP','AV','DV','STOAV','STOAP']);
const _UNIQUE_NAME    = new Set(['CONTACTOR','VALVE3V','RUNTIMCNT','WAIT','WAITH',
                                  'PULSE','INPUT','OUTPUT','PT_IN','ANA_IN','SENSOR']);

function _allUsedNames(){
  const s=new Set();
  pages.forEach(pg2=>pg2.blocks.forEach(b=>{
    const pp=b.params||{};
    if(pp.varname) s.add(pp.varname);
    if(pp.name)    s.add(pp.name);
    if(pp.bit)     s.add(pp.bit);
  }));
  return s;
}

function _allUsedRFNums(){
  const used=new Set();
  pages.forEach(pg2=>pg2.blocks.forEach(b=>{
    Object.values(b.params||{}).forEach(v=>{
      if(typeof v==='string'){
        const m=v.match(/^RF(\d+)$/);
        if(m) used.add(parseInt(m[1],10));
      }
    });
  }));
  return used;
}

function _remapBlockRFs(params){
  const usedNums=_allUsedRFNums();
  const localRFs=new Set();
  Object.values(params).forEach(v=>{
    if(typeof v==='string'&&/^RF\d+$/.test(v)) localRFs.add(v);
  });
  if(!localRFs.size) return params;
  let cursor=0;
  const rfMap={};
  localRFs.forEach(rf=>{
    while(usedNums.has(cursor)) cursor++;
    rfMap[rf]=`RF${cursor}`;
    usedNums.add(cursor);
    cursor++;
  });
  const out={};
  Object.entries(params).forEach(([k,v])=>{
    out[k]=(typeof v==='string'&&rfMap[v])?rfMap[v]:v;
  });
  return out;
}

function _uniqueNew(base, used){
  if(!used.has(base)){ used.add(base); return base; }
  const m=base.match(/^(.*?)(\d+)$/);
  if(m){
    let i=parseInt(m[2],10)+1;
    while(used.has(`${m[1]}${i}`)) i++;
    const n=`${m[1]}${i}`; used.add(n); return n;
  }
  let i=2;
  while(used.has(`${base}_${i}`)) i++;
  const n=`${base}_${i}`; used.add(n); return n;
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
  let params=defParams(t);

  // 1. Remap RF : chaque RF du nouveau bloc recoit un numero libre
  params=_remapBlockRFs(params);

  // 2. varname unique (BACKUP, AV, DV, STOAV, STOAP)
  if(_UNIQUE_VARNAME.has(t)&&params.varname){
    params.varname=_uniqueNew(params.varname,_allUsedNames());
  }
  // 3. name unique (INPUT, OUTPUT, SENSOR, CONTACTOR, etc.)
  if(_UNIQUE_NAME.has(t)&&params.name){
    params.name=_uniqueNew(params.name,_allUsedNames());
  }
  // 4. Numéro CONN libre (CONN, CONN_TX, CONN_RX)
  if(t==='CONN'||t==='CONN_TX'||t==='CONN_RX'){
    const n=_nextConnNum();
    params.num=n;
    params.label=`C${n}`;
  }

  const b={id:bid,type:t,x:sn(wx),y:sn(wy),w:BW,h:computeH(t),
           params,ports_in:[],ports_out:[],active:false};
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
  if(t==='CONN_TX') return{num:1,label:'C1'};
  if(t==='CONN_RX') return{num:1,label:'C1'};
  if(['TON','TOF','TP'].includes(t))return{preset_ms:1000};
  if(['CTU','CTD','CTUD'].includes(t))return{preset:10};
  if(t==='PT_IN')   return{analog_ref:'PT0',pt_type:'pt100',spi_ch:0,reg_out:'RF0',wires:3,name:'Sonde PT100'};
  if(t==='ANA_IN')  return{analog_ref:'ANA0',ads_ch:0,reg_out:'RF1',name:'Entrée analogique'};
  if(t==='DS_IN')   return{analog_ref:'DS0',rom_id:'',resolution:12,reg_out:'RF2',name:'Sonde DS18B20'};
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
  if(t==='PROG_H') return{
    name:'Planning',
    hebdo_mode: false,            // false=simple, true=par jour
    h_debut_j:6,  m_debut_j:30,  // plage jour par défaut (mode simple)
    h_fin_j:22,   m_fin_j:0,
    sp_jour:20.0, sp_nuit:17.0, sp_vac:15.0,
    // Planning hebdomadaire : d0=Lun … d6=Dim
    d0:{active:true, h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d1:{active:true, h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d2:{active:true, h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d3:{active:true, h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d4:{active:true, h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d5:{active:false,h_deb:8,m_deb:0, h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    d6:{active:false,h_deb:8,m_deb:0, h_fin:22,m_fin:0,sp_jour:20.0,sp_nuit:17.0},
    reg_sp:'RF5', out_jour:'', out_vac_dv:'', out_actif:'',
  };

  if(t==='NAND')     return{};
  if(t==='NOR')      return{};
  if(t==='BOOLEAN')  return{n_in:4,n_out:1,invert_o1:false,invert_o2:false,truth_table:null};
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
  if(b.type==='BOOLEAN')  { updPortsBoolean(b);   return; }
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

function updPortsBoolean(b){
  const nIn  = Math.min(6, Math.max(1, parseInt(b.params.n_in)||4));
  const nOut = Math.min(2, Math.max(1, parseInt(b.params.n_out)||1));
  const ins=[], outs=[];
  for(let i=1;i<=nIn; i++) ins.push(`I${i}`);
  for(let i=1;i<=nOut;i++) outs.push(`O${i}`);
  b.ports_in =ins.map( (n,i)=>({name:n,x:b.x,    y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.ports_out=outs.map((n,i)=>({name:n,x:b.x+b.w,y:b.y+HDR+PTOP+i*PGAP+PGAP/2}));
  b.h=HDR+PTOP+Math.max(nIn,nOut,1)*PGAP+8;
  // Initialiser la table de vérité si absente ou mauvaise taille
  const rows=1<<nIn;
  if(!b.params.truth_table||b.params.truth_table.length!==rows){
    b.params.truth_table=Array.from({length:rows},()=>Array.from({length:nOut},()=>0));
  }
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
  // ── Auto-assignation RF ────────────────────────────────────────────────────
  _assignWireRF(p, sBid, sPort, dBid, dPort);
  // ── Fin auto-assignation ───────────────────────────────────────────────────
  notifyChange();render();
}

function delWire(w){
  pushUndo();
  // ── Libérer le RF auto-assigné avant de supprimer le fil ──────────────────
  _releaseWireRF(pg(), w);
  // ── Fin libération ────────────────────────────────────────────────────────
  pg().wires=pg().wires.filter(x=>x!==w);
  if(selW===w){selW=null;showEmptyProps();}
  notifyChange();render();
}


// ════════════════════════════════════════════════════════════
// POPUP CHOIX CONNEXION (Fil ou Étiquettes)
// ════════════════════════════════════════════════════════════
function showConnectPopup(sBid,sPort,dBid,dPort,cx,cy){
  const old=document.getElementById('_wire_popup');
  if(old)old.remove();

  const pop=document.createElement('div');
  pop.id='_wire_popup';
  const W=192, H=116;
  const left=Math.min(cx-W/2, window.innerWidth-W-8);
  const top=Math.min(cy-H-18, window.innerHeight-H-8);
  pop.style.cssText=`
    position:fixed;left:${Math.max(4,left)}px;top:${Math.max(4,top)}px;
    width:${W}px;
    background:#161b22;border:1px solid #30363d;border-radius:10px;
    padding:10px 10px 9px;display:flex;flex-direction:column;gap:7px;
    z-index:99999;box-shadow:0 6px 28px #000c;
    font-family:'JetBrains Mono',monospace;
    animation:_wpIn .12s ease;
  `;

  const connPreview=`C${_nextConnNum()}`;

  pop.innerHTML=`
    <style>
      @keyframes _wpIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
      #_wp_wire:hover{background:#2f81f7!important;}
      #_wp_conn:hover{background:#1a3a25!important;}
    </style>
    <div style="font-size:10px;color:#8b949e;text-align:center;letter-spacing:.06em;margin-bottom:1px;">
      TYPE DE CONNEXION
    </div>
    <button id="_wp_wire" style="background:#1f6feb;color:#e6edf3;border:none;border-radius:6px;
      padding:8px 0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;
      display:flex;align-items:center;justify-content:center;gap:6px;transition:background .15s;">
      <span style="font-size:15px;line-height:1;letter-spacing:-2px;">━━</span>&nbsp;Fil direct
    </button>
    <button id="_wp_conn" style="background:#0d2016;color:#3fb950;border:1px solid #238636;border-radius:6px;
      padding:8px 0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;
      display:flex;align-items:center;justify-content:center;gap:5px;transition:background .15s;">
      <span style="font-size:14px;line-height:1;">⊙</span>
      CONN
      <span style="font-size:9px;color:#39d353;font-weight:normal;opacity:.85;">${connPreview}</span>
    </button>
  `;
  document.body.appendChild(pop);

  function close(){
    pop.style.opacity='0'; pop.style.transform='scale(.92)';
    pop.style.transition='opacity .09s,transform .09s';
    setTimeout(()=>pop.remove(),100);
    document.removeEventListener('keydown',onEsc);
  }
  function onEsc(ev){if(ev.key==='Escape')close();}
  document.addEventListener('keydown',onEsc);

  setTimeout(()=>{
    document.addEventListener('click',function h(ev){
      if(!pop.contains(ev.target)){close();document.removeEventListener('click',h);}
    },true);
  },80);

  document.getElementById('_wp_wire').addEventListener('click',ev=>{
    ev.stopPropagation(); close();
    addWire(sBid,sPort,dBid,dPort);
  });
  document.getElementById('_wp_conn').addEventListener('click',ev=>{
    ev.stopPropagation(); close();
    addConnPair(sBid,sPort,dBid,dPort);
  });
}

// Canvas infini : addLabelPair/_nextSigName supprimés
// (plus de PAGE_IN/PAGE_OUT — les fils traversent le canvas sans limite)

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
  // FIX: si le bloc source est un OR/INV/XOR logique dont active est faux mais
  // dont le bit M temp correspondant est actif dans state.memory → fil vert.
  let digitalOn = sb&&sb.active;
  if(!digitalOn && sb && _LOGIC_WIRE_TYPES.has(sb.type)){
    // 1) Lire le bit M temp associé (stocké dans sb._mbit si disponible)
    if(sb._mbit && _simState.memory && _simState.memory[sb._mbit]){
      digitalOn = true;
    }
    // 2) Lire reg_out RF* directement dans _simState.registers
    if(!digitalOn){
      const _sro=(sb.params||{}).reg_out;
      if(_sro && typeof _sro==='string' && _sro.startsWith('RF') && _simState.registers){
        const _srv=_simState.registers[_sro];
        if(_srv!=null && Math.abs(parseFloat(_srv))>0.01) digitalOn=true;
      }
    }
  }
  const anaVal    = !digitalOn&&sb?_getSimValue(sb):null;  // valeur analogique
  const hasData   = anaVal!==null&&anaVal!==undefined;

  const col = sel?'#f0883e'
            : digitalOn?'#3fb950'
            : hasData?'#00d4ff'
            : '#58a6ff';

  // ── Halo vert : signal numérique ON ─────────────────────────
  if(digitalOn&&!sel){
    ctx.save();
    ctx.strokeStyle='#3fb95055';ctx.lineWidth=6/vp.scale;
    ctx.shadowColor='#3fb950';ctx.shadowBlur=10/vp.scale;
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(w.sx,w.sy);bez(ctx,w.sx,w.sy,w.dx,w.dy);ctx.stroke();
    ctx.restore();
  }
  // ── Halo cyan léger : données analogiques ───────────────────
  if(hasData&&!sel&&!digitalOn){
    ctx.save();
    ctx.strokeStyle='#00d4ff33';ctx.lineWidth=4/vp.scale;
    ctx.shadowColor='#00d4ff';ctx.shadowBlur=5/vp.scale;
    ctx.setLineDash([]);
    ctx.beginPath();ctx.moveTo(w.sx,w.sy);bez(ctx,w.sx,w.sy,w.dx,w.dy);ctx.stroke();
    ctx.restore();
  }

  // ── Fil principal ───────────────────────────────────────────
  ctx.strokeStyle=col;
  ctx.lineWidth=(sel?2.5:digitalOn?2:hasData?1.8:1.5)/vp.scale;
  ctx.shadowColor=sel?'#f0883e':digitalOn?'#3fb950':hasData?'#00d4ff55':'transparent';
  ctx.shadowBlur=sel?6/vp.scale:digitalOn?4/vp.scale:hasData?2/vp.scale:0;
  ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(w.sx,w.sy);bez(ctx,w.sx,w.sy,w.dx,w.dy);ctx.stroke();
  ctx.shadowBlur=0;

  // ── Points aux extrémités ───────────────────────────────────
  [[w.sx,w.sy],[w.dx,w.dy]].forEach(([x,y])=>{
    ctx.beginPath();ctx.arc(x,y,3/vp.scale,0,Math.PI*2);
    ctx.fillStyle=col;ctx.fill();
  });
}


// ════════════════════════════════════════════════════════════
// RENDU CARTOUCHE (cadre de dessin industriel)
// ════════════════════════════════════════════════════════════
function _drawCartouche(b, sel){
  const p = b.params||{};
  const sc = vp.scale;
  const CART_H   = 100;  // hauteur du bloc cartouche en bas
  const MARGIN   = 12;   // marge intérieure double cadre

  // ── Fond très légèrement teinté ────────────────────────────
  ctx.fillStyle = sel ? '#12192e' : '#0d1421';
  ctx.globalAlpha = 0.35;
  _rr(b.x, b.y, b.w, b.h, 0);
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Cadre extérieur ────────────────────────────────────────
  const lw = (sel ? 2.5 : 1.5) / sc;
  ctx.strokeStyle = sel ? '#58a6ff' : '#3d5070';
  ctx.lineWidth   = lw;
  ctx.setLineDash(sel ? [] : [8/sc, 4/sc]);
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Cadre intérieur (marge double) ─────────────────────────
  ctx.strokeStyle = sel ? '#3a5a8a' : '#243040';
  ctx.lineWidth   = 0.8 / sc;
  ctx.beginPath();
  ctx.rect(b.x + MARGIN/sc, b.y + MARGIN/sc,
           b.w - 2*MARGIN/sc, b.h - 2*MARGIN/sc);
  ctx.stroke();

  // ── Bloc titre en bas à droite (cartouche IEC) ────────────
  const ch   = CART_H / sc;
  const cx   = b.x + b.w - 400/sc;
  const cy   = b.y + b.h - ch;

  // Fond cartouche
  ctx.fillStyle = '#0d1828';
  ctx.fillRect(cx, cy, 400/sc, ch);
  ctx.strokeStyle = sel ? '#58a6ff' : '#3d5070';
  ctx.lineWidth   = lw;
  ctx.strokeRect(cx, cy, 400/sc, ch);

  // Séparateurs verticaux
  const col1w = 240/sc, col2w = 80/sc;
  ctx.lineWidth = 0.8/sc;
  ctx.strokeStyle = '#2d4060';
  ctx.beginPath();
  ctx.moveTo(cx + col1w, cy);  ctx.lineTo(cx + col1w, cy + ch);
  ctx.moveTo(cx + col1w + col2w, cy); ctx.lineTo(cx + col1w + col2w, cy + ch);
  ctx.stroke();

  // Séparateur horizontal milieu
  ctx.beginPath();
  ctx.moveTo(cx, cy + ch/2); ctx.lineTo(cx + 400/sc, cy + ch/2);
  ctx.stroke();

  // Textes
  const fs  = b => `${b/sc}px 'JetBrains Mono',monospace`;
  ctx.textBaseline = 'middle';

  // Titre (grand, col1 haut)
  ctx.fillStyle  = '#e6edf3';
  ctx.font       = `bold ${fs(14)}`;
  ctx.textAlign  = 'left';
  _clipText(ctx, p.title||'Sans titre',
            cx + 6/sc, cy + ch/4, col1w - 10/sc);

  // Subtitle (col1 bas)
  ctx.fillStyle = '#8b949e';
  ctx.font      = fs(9);
  _clipText(ctx, p.subtitle||'',
            cx + 6/sc, cy + 3*ch/4, col1w - 10/sc);

  // Rev (col2 haut)
  ctx.fillStyle  = '#d29922';
  ctx.font       = `bold ${fs(10)}`;
  ctx.textAlign  = 'center';
  ctx.fillText(`Rev ${p.rev||'1'}`, cx + col1w + col2w/2, cy + ch/4);

  // Date (col2 bas)
  ctx.fillStyle = '#8b949e';
  ctx.font      = fs(9);
  ctx.fillText(p.date||'', cx + col1w + col2w/2, cy + 3*ch/4);

  // Sheet (col3 haut)
  ctx.fillStyle  = '#58a6ff';
  ctx.font       = `bold ${fs(12)}`;
  ctx.textAlign  = 'center';
  ctx.fillText(p.sheet||'1', cx + col1w + col2w + (400/sc - col1w - col2w)/2, cy + ch/4);

  // Author (col3 bas)
  ctx.fillStyle = '#8b949e';
  ctx.font      = fs(9);
  ctx.fillText(p.author||'', cx + col1w + col2w + (400/sc - col1w - col2w)/2, cy + 3*ch/4);

  // Libellés grisés
  const lbl = (txt, x, y) => {
    ctx.fillStyle = '#3d5070'; ctx.font = fs(7);
    ctx.textAlign = 'left';
    ctx.fillText(txt, x + 3/sc, y + 5/sc);
  };
  lbl('TITRE', cx, cy);
  lbl('REV',   cx + col1w, cy);
  lbl('FEUILLE', cx + col1w + col2w, cy);

  // Ligne Auteur / Date
  if(p.author){
    ctx.fillStyle = '#3d5070'; ctx.font = fs(7); ctx.textAlign='left';
    ctx.fillText('PAR', cx, cy + ch/2 + 4/sc);
  }

  // Poignée de redimensionnement
  if(sel){
    const hs = 9/sc;
    ctx.fillStyle = '#1f6feb';
    ctx.fillRect(b.x+b.w - hs, b.y+b.h - hs, hs, hs);
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5/sc;
    ctx.beginPath();
    ctx.moveTo(b.x+b.w - hs+2/sc, b.y+b.h - 2/sc);
    ctx.lineTo(b.x+b.w - 2/sc, b.y+b.h - hs+2/sc);
    ctx.stroke();
  }
}

function _clipText(ctx, text, x, y, maxW){
  ctx.textAlign = 'left';
  // Tronquer si trop long
  while(text.length>0 && ctx.measureText(text+'…').width > maxW) text=text.slice(0,-1);
  ctx.fillText(text.length<(arguments[1]||Infinity) ? text+'…' : text, x, y);
}
function _rr(x,y,w,h,r){ ctx.beginPath(); ctx.rect(x,y,w,h); }

function drawBlock(b,sel){
  // ── Rendu spécial CARTOUCHE ────────────────────────────────────
  if(b.type==='CARTOUCHE'){
    _drawCartouche(b,sel);
    return;
  }
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

  // ── Valeur analogique en simulation ──────────────────────────────────────
  const _anaVal=_getSimValue(b);
  if(_anaVal!==null){
    const _av_s=typeof _anaVal==='number'
      ?(_anaVal%1===0?_anaVal.toFixed(0):_anaVal.toFixed(1))
      :String(_anaVal);
    const _unit=b.params&&b.params.unit?b.params.unit:'';
    // Pour CONN / CONN_TX / CONN_RX : afficher sous le numéro ; pour les autres : en bas du bloc
    const _valY=(b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX')
      ?(b.y+b.h/2+HDR/4+11/vp.scale)
      :(b.y+b.h-10/vp.scale);
    ctx.save();
    ctx.fillStyle='#00d4ff';
    ctx.font=`bold ${9/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='#00d4ff';ctx.shadowBlur=4/vp.scale;
    ctx.fillText(_av_s+_unit, b.x+b.w/2, _valY);
    ctx.restore();
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
                 (b.type==='DV')?'#f0883e':
                 (b.type==='CONN')?'#00eaff':
                 (b.type==='CONN_TX')?'#f0883e':
                 (b.type==='CONN_RX')?'#39d3b0':'#3fb950';
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
  if(b.type==='CONN_TX'){
    ctx.font=`bold ${14/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#f0883e';
    ctx.fillText('→'+(b.params.num||'?'),b.x+b.w/2,b.y+b.h/2+HDR/4);
  }
  if(b.type==='CONN_RX'){
    ctx.font=`bold ${14/vp.scale}px 'JetBrains Mono',monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle='#39d3b0';
    ctx.fillText('←'+(b.params.num||'?'),b.x+b.w/2,b.y+b.h/2+HDR/4);
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

// Retourne la valeur analogique simulée d'un bloc, ou null si non applicable
function _getSimValue(b){
  if(!_simState||!b.params)return null;
  const p=b.params;
  const ANALOG_TYPES=['SENSOR','PT_IN','ANA_IN','DS_IN','ADD','SUB','MUL','DIV',
    'AVG','MIN','MAX','ABS','SQRT','MOD','POW','SCALE','FILT1','INTEG',
    'DERIV','DEADB','RAMP','CLAMP','BACKUP','AV','STOAV','CONN','CONN_TX','CONN_RX'];
  if(!ANALOG_TYPES.includes(b.type))return null;

  // CONN → remonter le fil entrant pour trouver la valeur source
  if(b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX'){
    // 1. Registres compilés (si dispo depuis le serveur)
    const ri=p.reg_in, ro=p.reg_out;
    const regs=_simState.registers||{};
    if(ri&&regs[ri]!=null) return regs[ri];
    if(ro&&regs[ro]!=null) return regs[ro];
    // 2. Remonter via le fil branché sur IN
    const pageC=pg();
    const inW=pageC.wires.find(w=>w.dst.bid===b.id&&w.dst.port==='IN');
    if(inW){
      const src=pageC.blocks.find(x=>x.id===inW.src.bid);
      if(src) return _getSimValue(src);
    }
    // 3. Trouver le CONN pair (même num) qui a un fil entrant
    const peer=pageC.blocks.find(x=>
      (x.type==='CONN'||x.type==='CONN_TX'||x.type==='CONN_RX')&&x.params.num===b.params.num&&x.id!==b.id&&
      pageC.wires.some(w=>w.dst.bid===x.id&&w.dst.port==='IN'));
    if(peer) return _getSimValue(peer);
    return null;
  }

  // SENSOR / PT_IN / ANA_IN / DS_IN → valeur °C ou tension
  if(['SENSOR','PT_IN','ANA_IN','DS_IN'].includes(b.type)){
    const ref=p.analog_ref||p.reg_out;
    if(ref&&_simState.analog&&_simState.analog[ref]!=null){
      const celsius=_simState.analog[ref].celsius??_simState.analog[ref];
      return typeof celsius==='number'?celsius:null;
    }
    if(ref&&_simState.registers&&_simState.registers[ref]!=null)
      return _simState.registers[ref];
    return null;
  }

  // AV / STOAV → dv_vars ou av_vars
  if(['AV','STOAV'].includes(b.type)){
    const vn=(p.varname||'').toLowerCase();
    if(_simState.av_vars&&_simState.av_vars[vn]!=null) return _simState.av_vars[vn];
    if(_simState.dv_vars&&_simState.dv_vars[vn]!=null) return _simState.dv_vars[vn];
    return null;
  }

  // BACKUP → registre ou variable
  if(b.type==='BACKUP'){
    const vn=(p.varname||'').toLowerCase();
    if(_simState.dv_vars&&_simState.dv_vars[vn]!=null) return _simState.dv_vars[vn];
    if(p.reg_out&&_simState.registers&&_simState.registers[p.reg_out]!=null)
      return _simState.registers[p.reg_out];
    return null;
  }

  // ADD, AVG, SCALE, etc. → registre de sortie (params ou directement sur le bloc)
  const rout=p.reg_out||p.reg_c||b.reg_out;
  if(rout&&_simState.registers&&_simState.registers[rout]!=null)
    return _simState.registers[rout];

  // Fallback : remonter via les fils entrants (propagation depuis la source)
  {
    const pageF=pg();
    const inWs=pageF.wires.filter(w=>w.dst.bid===b.id);
    for(const w of inWs){
      const src=pageF.blocks.find(x=>x.id===w.src.bid);
      if(src){const v=_getSimValue(src);if(v!==null)return v;}
    }
  }
  return null;
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
  if(b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX') return'';
  if(['TON','TOF','TP'].includes(b.type))return`${p.preset_ms}ms`;
  if(['CTU','CTD','CTUD'].includes(b.type))return`PV=${p.preset}`;
  if(b.type==='PT_IN')  return p.name||p.analog_ref||'PT0';
  if(b.type==='ANA_IN') return p.name||p.analog_ref||'ANA0';
  if(b.type==='DS_IN')  return p.name||p.analog_ref||'DS0';
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
  if(b.type==='NAND')     return 'NAND';
  if(b.type==='NOR')      return 'NOR';
  if(b.type==='BOOLEAN')  return `BOOL ${b.params.n_in||4}→${b.params.n_out||1}`;
  if(b.type==='CONTACTOR')return p.name||'K1';
  if(b.type==='VALVE3V') return p.name||'V3V';
  if(b.type==='RUNTIMCNT')return p.name||'Cpt';
  if(b.type==='MQTT'){
    const t=p.topic||'';
    const parts=t.split('/');
    // Affiche les 2 derniers segments si le topic est long.
    // ASCII pur (pas de glyphe Unicode "…" qui peut se confondre
    // avec "../" au rendu canvas en petite taille).
    const short=parts.length>2?'(..)/'+parts.slice(-2).join('/'):t;
    const dir=(p.reg_out&&p.reg_in)?'<->':(p.reg_out?'<-':'->');
    return dir+' '+short;
  }
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
  let best=null, bestDist=12/vp.scale;
  for(const w of pg().wires){
    if(!('sx'in w))continue;
    for(let i=0;i<=64;i++){
      const pt=bezPt(w.sx,w.sy,w.dx,w.dy,i/64);
      const d=Math.hypot(wx-pt.x,wy-pt.y);
      if(d<bestDist){bestDist=d;best=w;}
    }
  }return best;
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
  // ── Fils : priorité AVANT les blocs (un fil fin est plus difficile à cliquer)
  const wh=hitWire(w.x,w.y);
  if(wh){selW=wh;selB=null;multiSel.clear();showWireProps(wh);render();return;}
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
      if(sb)showConnectPopup(sb,sp,db,dp,e.clientX,e.clientY);
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
    'PULSE','BACKUP','AV','DV','PID','COMPH','COMPL','SR_R','SR_S','BOOLEAN'];
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
  const p=b.params||{};   // alias court — utilisé par tous les panneaux blocs métier
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
  }else if(b.type==='CARTOUCHE'){
    html=`<div class='pr'><label class='pl'>TITRE</label>
      <input class='pi' value='${ep(p.title||'')}' onchange="_upd(b,'title',this.value)"></div>
      <div class='pr'><label class='pl'>SOUS-TITRE</label>
      <input class='pi' value='${ep(p.subtitle||'')}' onchange="_upd(b,'subtitle',this.value)"></div>
      <div class='pr'><label class='pl'>AUTEUR</label>
      <input class='pi' value='${ep(p.author||'')}' onchange="_upd(b,'author',this.value)"></div>
      <div class='pr'><label class='pl'>RÉVISION</label>
      <input class='pi' value='${ep(p.rev||'1')}' onchange="_upd(b,'rev',this.value)"></div>
      <div class='pr'><label class='pl'>DATE</label>
      <input class='pi' type='date' value='${p.date||''}' onchange="_upd(b,'date',this.value)"></div>
      <div class='pr'><label class='pl'>N° FEUILLE</label>
      <input class='pi' value='${ep(p.sheet||'1')}' onchange="_upd(b,'sheet',this.value)"></div>
      <hr class='psep'>
      <button class='pb' onclick="_printCartouche('${b.id}')">🖨 Imprimer cette zone</button>`;
  }else if(b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX'){
    h+=pNum('num','Numéro',b.params.num||1,1,999);
    h+=pTxt('label','Étiquette',b.params.label||'C1');
    const avail=findConnPeers(b);
    h+=`<hr class="psep"><span class="pl">Connecteurs jumelés</span>`;
    if(!avail.length){
      h+=`<div style="color:var(--fbd-text3);font-size:9px">Aucun #${b.params.num}.</div>`;
    } else {
      avail.forEach(c=>{
        const typeColor=c.btype==='CONN_TX'?'#f0883e':c.btype==='CONN_RX'?'#39d3b0':'#58a6ff';
        const typeLabel=c.btype==='CONN_TX'?'TX':c.btype==='CONN_RX'?'RX':'⇄';
        h+=`<div class="conn-row" onclick="goPage(${c.pageIdx})">
          <span>#${c.num} ${c.label} <span style="font-size:8px;color:${typeColor}">[${typeLabel}]</span></span>
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
    h+=pRF('reg_out','Registre sortie (°C)',b.params.reg_out||'RF0');
    h+=`<hr class="psep"><span class="pl">Simulation — Valeur °C</span>`;
    h+=`<div style="display:flex;gap:6px;align-items:center">
      <input class="pi" id="sim_val_${b.id}" type="range" min="-50" max="200" step="0.5"
        value="${b._simVal||20}" style="flex:1" data-bid="${b.id}">
      <span id="sim_lbl_${b.id}" style="color:#00d4ff;min-width:50px">${(b._simVal||20).toFixed(1)}°C</span>
    </div>`;
  }else if(b.type==='ANA_IN'){
    h+=pTxt('name','Nom entrée',b.params.name||'Entrée ANA');
    h+=pSel('ads_ch','Canal ADS1115',b.params.ads_ch||0,ADS_CH);
    h+=pRF('reg_out','Registre sortie',b.params.reg_out||'RF1');
    h+=`<hr class="psep"><span class="pl">Simulation — Valeur (V)</span>`;
    h+=`<div style="display:flex;gap:6px;align-items:center">
      <input class="pi" id="sim_val_${b.id}" type="range" min="0" max="5" step="0.01"
        value="${b._simVal||0}" style="flex:1" data-bid="${b.id}">
      <span id="sim_lbl_${b.id}" style="color:#58cfff;min-width:50px">${(b._simVal||0).toFixed(3)}V</span>
    </div>`;
  }else if(b.type==='DS_IN'){
    h+=pTxt('name','Nom de la sonde',b.params.name||'Sonde DS18B20');
    h+=pSel('analog_ref','Référence',b.params.analog_ref||'DS0',DS_REFS.map(r=>({v:r,l:r})));
    h+=pTxt('rom_id','ID ROM 1-Wire (optionnel)',b.params.rom_id||'');
    h+=`<div style="color:var(--fbd-text3);font-size:9px;padding:0 2px 4px">
      Laisser vide = assignation automatique par ordre de découverte sur le bus.
      Ex: 28-000008a1b2c3 (voir config.json → analog.ds18b20).</div>`;
    h+=pSel('resolution','Résolution',b.params.resolution||12,[
      {v:9,l:'9 bits (0.5°C, ~94ms)'},{v:10,l:'10 bits (0.25°C, ~188ms)'},
      {v:11,l:'11 bits (0.125°C, ~375ms)'},{v:12,l:'12 bits (0.0625°C, ~750ms)'}]);
    h+=pRF('reg_out','Registre sortie (°C)',b.params.reg_out||'RF2');
    h+=`<hr class="psep"><span class="pl">Simulation — Valeur °C</span>`;
    h+=`<div style="display:flex;gap:6px;align-items:center">
      <input class="pi" id="sim_val_${b.id}" type="range" min="-40" max="125" step="0.1"
        value="${b._simVal??20}" style="flex:1" data-bid="${b.id}">
      <span id="sim_lbl_${b.id}" style="color:#00ffa0;min-width:50px">${(b._simVal??20).toFixed(1)}°C</span>
    </div>`;
  }else if(b.type==='COMPARE_F'){
    h+=pRF('reg_ref','Registre mesuré',b.params.reg_ref||'RF0');
    h+=pNum('threshold','Seuil',b.params.threshold||80.0,-9999,9999,0.1);
    h+=pNum('hysteresis','Hystérésis',b.params.hysteresis||1.0,0,100,0.1);
    h+=pSel('op','Opération',b.params.op||'gt',[
      {v:'gt',l:'> (supérieur)'},{v:'lt',l:'< (inférieur)'},
      {v:'ge',l:'>= (supérieur ou égal)'},{v:'le',l:'<= (inférieur ou égal)'},
      {v:'eq',l:'= (égal +/-hyst)'}
    ]);
  }else if(b.type==='SCALE'){
    h+=pRF('reg_ref','Registre source',b.params.reg_ref||'RF1');
    h+=pRF('reg_out','Registre sortie',b.params.reg_out||'RF2');
    h+=`<hr class="psep"><span class="pl">Entrée brute</span>`;
    h+=pNum('in_lo','Min entrée',b.params.in_lo||0,-99999,99999,0.001);
    h+=pNum('in_hi','Max entrée',b.params.in_hi||5.0,-99999,99999,0.001);
    h+=`<span class="pl">Sortie</span>`;
    h+=pNum('out_lo','Min sortie',b.params.out_lo||0,-99999,99999,0.1);
    h+=pNum('out_hi','Max sortie',b.params.out_hi||100.0,-99999,99999,0.1);
  }else if(b.type==='PID'){
    h+=pRF('pv_ref','Mesure (PV)',b.params.pv_ref||'RF0');
    h+=pNum('setpoint','Consigne (SP)',b.params.setpoint||50.0,-9999,9999,0.1);
    h+=`<hr class="psep"><span class="pl">Gains PID</span>`;
    h+=pNum('kp','Kp (proportionnel)',b.params.kp||1.0,0,9999,0.01);
    h+=pNum('ki','Ki (intégral)',b.params.ki||0.1,0,9999,0.001);
    h+=pNum('kd','Kd (dérivé)',b.params.kd||0.0,0,9999,0.001);
    h+=`<hr class="psep"><span class="pl">Sortie</span>`;
    h+=pNum('out_min','Min sortie (%)',b.params.out_min||0,-100,100,0.1);
    h+=pNum('out_max','Max sortie (%)',b.params.out_max||100,0,200,0.1);
    h+=pRF('reg_out','Registre sortie',b.params.reg_out||'RF3');
  }else if(b.type==='SENSOR'){
    h+=pTxt('name','Nom capteur',b.params.name||'Capteur');
    h+=pSel('ref','Entrée analogique',b.params.ref||'ANA0',_anaOptions());
    h+=pNum('correction','Correction (deg)',b.params.correction||0.0,-20,20,0.1);
    h+=pRF('reg_out','Registre sortie (RF)',b.params.reg_out||'RF0');
  }else if(b.type==='ADD'||b.type==='SUB'||b.type==='MUL'||b.type==='DIV'){
    const ops={ADD:'+',SUB:'-',MUL:'x',DIV:'/'};
    h+=`<span class="pl">RF_A ${ops[b.type]} RF_B vers RF_OUT</span>`;
    h+=pRF('reg_a','Opérande A',b.params.reg_a||'RF0');
    h+=pRF('reg_b','Opérande B',b.params.reg_b||'RF1');
    h+=pRF('reg_out','Résultat',b.params.reg_out||'RF2');
  }else if(b.type==='MUX'){
    h+=pSel('idx_ref','Index (bit mémoire)',b.params.idx_ref||'M0',MEMS.map(m=>({v:m,l:m})));
    h+=pRF('in0','In0 (idx=0)',b.params.in0||'RF0');
    h+=pRF('in1','In1 (idx=1)',b.params.in1||'RF1');
    h+=pRF('in2','In2 (idx=2)',b.params.in2||'RF2');
    h+=pRF('in3','In3 (idx=3)',b.params.in3||'RF3');
    h+=pRF('reg_out','Sortie',b.params.reg_out||'RF4');
  }else if(b.type==='COMPH'){
    h+=pRF('ref','Registre mesuré',b.params.ref||'RF0');
    h+=pNum('high','Seuil HAUT',b.params.high??80.0,-9999,9999,0.1);
    h+=pNum('hyst','Hystérésis',b.params.hyst??0.5,0,100,0.1);
    h+=pRF('reg_out','Sortie',b.params.reg_out||'M0');
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≥HAUT, OFF si IN&lt;(HAUT−hyst)</div>`;
  }else if(b.type==='COMPL'){
    h+=pRF('ref','Registre mesuré',b.params.ref||'RF0');
    h+=pNum('low','Seuil BAS',b.params.low??10.0,-9999,9999,0.1);
    h+=pNum('hyst','Hystérésis',b.params.hyst??0.5,0,100,0.1);
    h+=pRF('reg_out','Sortie',b.params.reg_out||'M1');
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≤BAS, OFF si IN>(BAS+hyst)</div>`;
  }else if(b.type==='ABS'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie |IN|',b.params.reg_out||'RF1');
  }else if(b.type==='MIN'||b.type==='MAX'){
    h+=pRF('reg_a','Entrée A',b.params.reg_a||'RF0');
    h+=pRF('reg_b','Entrée B',b.params.reg_b||'RF1');
    h+=pRF('reg_out','Sortie',b.params.reg_out||'RF2');
  }else if(b.type==='MOD'||b.type==='POW'){
    h+=pRF('reg_a',b.type==='POW'?'Base':'Dividende',b.params.reg_a||'RF0');
    h+=pRF('reg_b',b.type==='POW'?'Exposant':'Diviseur',b.params.reg_b||'RF1');
    h+=pRF('reg_out','Sortie',b.params.reg_out||'RF2');
  }else if(b.type==='SQRT'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie √IN',b.params.reg_out||'RF1');
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">√max(0, IN)</div>`;
  }else if(b.type==='CLAMP'||b.type==='CLAMP_A'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie clampée',b.params.reg_out||'RF1');
    h+=pNum('lo','Minimum',b.params.lo??0.0,-9999,9999,0.1);
    h+=pNum('hi','Maximum',b.params.hi??100.0,-9999,9999,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">Sortie CLIP=TRUE si IN hors plage</div>`;
  }else if(b.type==='SEL'){
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:2px 0">G=0 → IN0 · G=1 → IN1</div>`;
    h+=pRF('in0','IN0 (G=0)',b.params.in0||'RF0');
    h+=pRF('in1','IN1 (G=1)',b.params.in1||'RF1');
    h+=pRF('reg_out','Sortie',b.params.reg_out||'RF2');
  }else if(b.type==='FILT1'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie filtrée',b.params.reg_out||'RF1');
    h+=pNum('tc_s','Constante de temps (s)',b.params.tc_s??10.0,0.01,3600,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">α=dt/(tc+dt) — plus tc grand = plus lent</div>`;
  }else if(b.type==='AVG'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie moyenne',b.params.reg_out||'RF1');
    h+=pNum('n','Nb échantillons',b.params.n??10,2,200,1);
  }else if(b.type==='INTEG'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie intégrale',b.params.reg_out||'RF1');
    h+=pNum('ki','Gain Ki',b.params.ki??1.0,-100,100,0.01);
    h+=pNum('lo','Min sortie',b.params.lo??-1000,-1e6,0,0.1);
    h+=pNum('hi','Max sortie',b.params.hi??1000,0,1e6,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">OUT=MAX si saturé · RES remet à 0</div>`;
  }else if(b.type==='DERIV'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie dérivée',b.params.reg_out||'RF1');
    h+=pNum('kd','Gain Kd',b.params.kd??1.0,-100,100,0.01);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">OUT = Kd × ΔIN/Δt</div>`;
  }else if(b.type==='DEADB'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pRF('reg_out','Sortie',b.params.reg_out||'RF1');
    h+=pNum('dead','Bande morte (±)',b.params.dead??1.0,0,1000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">|IN|≤dead → OUT=0 · DEAD=TRUE si actif</div>`;
  }else if(b.type==='RAMP'){
    h+=pRF('reg_sp','Consigne (cible)',b.params.reg_sp||'RF0');
    h+=pRF('reg_out','Sortie rampée',b.params.reg_out||'RF1');
    h+=pNum('rate','Vitesse max (/s)',b.params.rate??1.0,0.001,10000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">DONE=TRUE quand OUT a atteint SP</div>`;
  }else if(b.type==='HYST'){
    h+=pRF('reg_in','Entrée',b.params.reg_in||'RF0');
    h+=pNum('sp','Point milieu',b.params.sp??50.0,-9999,9999,0.1);
    h+=pNum('band','Bande totale',b.params.band??2.0,0,1000,0.1);
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:4px 0">ON si IN≥sp+band/2 · OFF si IN≤sp−band/2</div>`;
  }else if(b.type==='MUX'){
    h+=pRF('idx_ref','Index (RF ou M)',b.params.idx_ref||'RF0');
    h+=pNum('n_in','Nb entrées',b.params.n_in||4,2,8,1);
    for(let i=0;i<(b.params.n_in||4);i++)
      h+=pRF(`in${i}`,`IN${i}`,b.params[`in${i}`]||`RF${i}`);
    h+=pRF('reg_out','Sortie VAL',b.params.reg_out||'RF4');
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
  }else if(b.type==='MQTT'){
    h+=`<div style="color:var(--fbd-text2);font-size:10px;padding:4px 0 6px">
      <b>Subscribe (SUB)</b> : lit le topic → ecrit dans reg_out (RF*)<br>
      <b>Publish (PUB)</b> : lit reg_in (RF*) → publie vers le topic<br>
      Les deux peuvent etre actifs sur le meme bloc.
    </div>`;
    h+=pTxt('topic','Topic MQTT',p.topic||'');
    h+=`<hr class="psep"><span class="pl">Subscribe → RF</span>`;
    h+=pRF('reg_out','Registre destination (SUB)',p.reg_out||'');
    h+=`<hr class="psep"><span class="pl">Publish ← RF</span>`;
    h+=pRF('reg_in','Registre source (PUB)',p.reg_in||'');
    h+=pSel('retain','Retain',p.retain?'1':'0',[{v:'0',l:'Non'},{v:'1',l:'Oui'}]);
    h+=`<hr class="psep"><span class="pl">Type de valeur</span>`;
    h+=pSel('val_type','Type',p.val_type||'float',[
      {v:'float',l:'Numerique (float)'},
      {v:'bool', l:'Booleen (0/1)'}
    ]);
    h+=`<hr class="psep"><span class="pl">Watchdog (Subscribe)</span>`;
    h+=`<div style="color:var(--fbd-text2);font-size:9px;padding:0 0 4px">
      Remet reg_out a 0 si aucun message recu depuis ce delai.
      0 = desactive (comportement par defaut). A activer seulement sur les
      topics qui doivent retomber a 0 en cas d'arret de publication
      (ex: charge/decharge batterie), pas sur les capteurs lents.
    </div>`;
    h+=pNum('stale_timeout','Timeout figé (s, 0=désactivé)',p.stale_timeout??0,0,3600,1);
    // Valeur actuelle (lecture protegee : liveState n'est jamais
    // declare/alimente nulle part dans le projet -> evite le
    // ReferenceError qui bloquait tout le panneau Proprietes)
    const _rt=p.reg_out||'';
    if(_rt && typeof liveState!=='undefined' && liveState && liveState.registers){
      const _rv = liveState.registers[_rt];
      if(_rv!=null && !isNaN(parseFloat(_rv)))
        h+=`<div style="margin-top:6px;color:#58a6ff;font-size:11px">Valeur : <b>${parseFloat(_rv).toFixed(2)}</b></div>`;
    }
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
    h+=pRF('pv_ref_amb','Sonde ambiante (PV principal)',p.pv_ref_amb||'RF0');
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
    h+=pRF('reg_out','Sortie PID (%)',p.reg_out||'RF8');
    h+=pRF('reg_depart','Registre T départ',p.reg_depart||'RF9');
    h+=pRF('reg_retour','Registre T retour',p.reg_retour||'RF10');
    h+=pRF('reg_delta','Registre Δ dép−ret',p.reg_delta||'RF11');
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
    h+=pRF('pv_ref_retour','Sonde retour',p.pv_ref_retour||'RF1');
    h+=pRF('pv_ref_depart','Sonde départ',p.pv_ref_depart||'RF2');
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
    h+=pRF('pv_ref_capteur','Sonde capteur solaire',(p.pv_ref_capteur||'RF0'));
    h+=pRF('pv_ref_ecs','Sonde ballon ECS',(p.pv_ref_ecs||'RF3'));
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
    h+=pRF('reg_delta','Registre ΔT capteur−ballon',p.reg_delta||'RF12');
    h+=pRF('reg_rendement','Registre énergie captée (%)',p.reg_rendement||'RF13');
    h+=`<div style="color:#69f0ae;font-size:9px;padding:4px 0;line-height:1.5">
      Vanne ECS ON = solaire vers ECS. Vanne Chauf ON = solaire vers plancher/chaudière.<br>
      Les deux vannes ne s'ouvrent jamais simultanément.</div>`;

  }else if(b.type==='ZONE_CHAUF'){
    const dvOpts=[...[...Array(10)].map((_,i)=>({v:`k${i+1}`,l:`K${i+1}`})),{v:'',l:'— aucun —'}];
    h+=pTxt('name','Nom zone',p.name||'Zone');
    h+=`<hr class="psep"><span class="pl">🌡 Régulation</span>`;
    h+=pRF('pv_ref','Sonde température',p.pv_ref||'RF0');
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
    h+=pRF('pv_ref_ecs','Sonde ballon ECS',p.pv_ref_ecs||'RF3');
    h+=pRF('pv_ref_prim','Sonde primaire',p.pv_ref_prim||'RF4');
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

  }else if(b.type==='PROG_H'){
    const p=b.params;
    const fH=v=>String(v??0).padStart(2,'0');
    const hOpts=(k,val)=>[...Array(24)].map((_,i)=>`<option value="${i}" ${parseInt(val??0)===i?'selected':''}>${fH(i)}</option>`).join('');
    const mOpts=(k,val)=>[0,15,30,45].map(i=>`<option value="${i}" ${parseInt(val??0)===i?'selected':''}>${fH(i)}</option>`).join('');
    const isHebdo=!!p.hebdo_mode;
    h+=pTxt('name','Nom du planning',p.name||'Planning');

    // Sélecteur de mode
    h+=`<hr class="psep">
    <div class="prop-row"><div class="prop-label">Mode</div>
      <select class="prop-input" id="prog_h_mode_sel" onchange="
        const h=this.value==='hebdo';
        b.params.hebdo_mode=h;
        document.getElementById('prog_h_simple').style.display=h?'none':'block';
        document.getElementById('prog_h_hebdo').style.display=h?'block':'none';
        wProp(b.id,'hebdo_mode',h);notifyChange();">
        <option value="simple" ${!isHebdo?'selected':''}>⏱ Simple — même plage tous les jours</option>
        <option value="hebdo"  ${isHebdo?'selected':''}>📅 Hebdomadaire — par jour de semaine</option>
      </select></div>`;

    // ── Mode simple ────────────────────────────────────────────────
    h+=`<div id="prog_h_simple" style="display:${isHebdo?'none':'block'}">`;
    h+=`<span class="pl">☀ Plage JOUR (tous les jours)</span>`;
    h+=`<div class="prop-row"><div class="prop-label">Début</div>
      <div style="display:flex;gap:4px;align-items:center;">
        <select class="prop-input" data-key="h_debut_j" style="width:56px">${hOpts('h_debut_j',p.h_debut_j??6)}</select>
        <span style="color:var(--fbd-text2);font-size:11px">h</span>
        <select class="prop-input" data-key="m_debut_j" style="width:56px">${mOpts('m_debut_j',p.m_debut_j??30)}</select>
        <span style="color:var(--fbd-text2);font-size:11px">min</span>
      </div></div>`;
    h+=`<div class="prop-row"><div class="prop-label">Fin</div>
      <div style="display:flex;gap:4px;align-items:center;">
        <select class="prop-input" data-key="h_fin_j" style="width:56px">${hOpts('h_fin_j',p.h_fin_j??22)}</select>
        <span style="color:var(--fbd-text2);font-size:11px">h</span>
        <select class="prop-input" data-key="m_fin_j" style="width:56px">${mOpts('m_fin_j',p.m_fin_j??0)}</select>
        <span style="color:var(--fbd-text2);font-size:11px">min</span>
      </div></div>`;
    h+=`</div>`;

    // ── Mode hebdomadaire ──────────────────────────────────────────
    const JOURS=[['d0','Lun'],['d1','Mar'],['d2','Mer'],['d3','Jeu'],['d4','Ven'],['d5','Sam'],['d6','Dim']];
    h+=`<div id="prog_h_hebdo" style="display:${isHebdo?'block':'none'}">`;
    h+=`<div style="color:#ffb300;font-size:9px;padding:2px 0 4px;">Cocher les jours actifs · Sam/Dim inactifs par défaut</div>`;
    JOURS.forEach(([dk,label])=>{
      const dc=p[dk]||{active:true,h_deb:6,m_deb:30,h_fin:22,m_fin:0,sp_jour:20,sp_nuit:17};
      const act=dc.active!==false;
      h+=`<div style="margin:4px 0;padding:6px 8px;background:${act?'#1a1000':'#0d1117'};border:1px solid ${act?'#ffb30060':'#30363d'};border-radius:6px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:${act?'4px':'0'}">
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;font-weight:bold;color:${act?'#ffb300':'#484f58'}">
            <input type="checkbox" ${act?'checked':''} style="cursor:pointer"
              onchange="
                const row=this.closest('[data-dkey]');
                const dk=row.dataset.dkey;
                if(!b.params[dk])b.params[dk]={};
                b.params[dk].active=this.checked;
                row.style.background=this.checked?'#1a1000':'#0d1117';
                row.style.borderColor=this.checked?'#ffb30060':'#30363d';
                const detail=row.querySelector('.day-detail');
                if(detail)detail.style.display=this.checked?'flex':'none';
                row.querySelector('label').style.color=this.checked?'#ffb300':'#484f58';
                notifyChange();renderAll();">
            ${label}
          </label>
        </div>
        <div class="day-detail" data-dk="${dk}" style="display:${act?'flex':'none'};flex-direction:column;gap:3px">
          <div style="display:flex;gap:4px;align-items:center;font-size:10px">
            <span style="color:var(--fbd-text2);width:32px">Début</span>
            <select style="background:var(--fbd-bg4);color:var(--fbd-text);border:1px solid var(--fbd-border);border-radius:3px;padding:1px;font-size:10px;width:48px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].h_deb=parseInt(this.value);notifyChange();">
              ${[...Array(24)].map((_,i)=>`<option value="${i}" ${parseInt(dc.h_deb??6)===i?'selected':''}>${fH(i)}</option>`).join('')}
            </select>h
            <select style="background:var(--fbd-bg4);color:var(--fbd-text);border:1px solid var(--fbd-border);border-radius:3px;padding:1px;font-size:10px;width:48px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].m_deb=parseInt(this.value);notifyChange();">
              ${[0,15,30,45].map(i=>`<option value="${i}" ${parseInt(dc.m_deb??30)===i?'selected':''}>${fH(i)}</option>`).join('')}
            </select>min
            <span style="color:var(--fbd-text2);margin-left:6px;width:24px">Fin</span>
            <select style="background:var(--fbd-bg4);color:var(--fbd-text);border:1px solid var(--fbd-border);border-radius:3px;padding:1px;font-size:10px;width:48px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].h_fin=parseInt(this.value);notifyChange();">
              ${[...Array(24)].map((_,i)=>`<option value="${i}" ${parseInt(dc.h_fin??22)===i?'selected':''}>${fH(i)}</option>`).join('')}
            </select>h
            <select style="background:var(--fbd-bg4);color:var(--fbd-text);border:1px solid var(--fbd-border);border-radius:3px;padding:1px;font-size:10px;width:48px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].m_fin=parseInt(this.value);notifyChange();">
              ${[0,15,30,45].map(i=>`<option value="${i}" ${parseInt(dc.m_fin??0)===i?'selected':''}>${fH(i)}</option>`).join('')}
            </select>min
          </div>
          <div style="display:flex;gap:6px;align-items:center;font-size:10px">
            <span style="color:#ffb300;width:32px">SP☀</span>
            <input type="number" min="5" max="35" step="0.5" value="${dc.sp_jour??20}" style="width:50px;background:var(--fbd-bg4);color:#ffb300;border:1px solid #ffb30060;border-radius:3px;padding:1px 3px;font-size:10px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].sp_jour=parseFloat(this.value);notifyChange();">°C
            <span style="color:#5c6bc0;margin-left:6px;width:32px">SP🌙</span>
            <input type="number" min="5" max="30" step="0.5" value="${dc.sp_nuit??17}" style="width:50px;background:var(--fbd-bg4);color:#5c6bc0;border:1px solid #5c6bc060;border-radius:3px;padding:1px 3px;font-size:10px"
              onchange="if(!b.params['${dk}'])b.params['${dk}']={};b.params['${dk}'].sp_nuit=parseFloat(this.value);notifyChange();">°C
          </div>
        </div>
      </div>`.replace(/data-dkey="[^"]*"/,'data-dkey="'+dk+'"');
    });
    h+=`</div>`;

    // ── Consignes globales & sorties ──────────────────────────────
    h+=`<hr class="psep"><span class="pl">🌡 Consignes globales</span>`;
    h+=pNum('sp_jour','SP JOUR par défaut (°C)',p.sp_jour??20.0,5,35,0.5);
    h+=pNum('sp_nuit','SP NUIT par défaut (°C)',p.sp_nuit??17.0,5,30,0.5);
    h+=pNum('sp_vac', 'SP VACANCES (°C)',       p.sp_vac??15.0, 5,25,0.5);
    h+=`<hr class="psep"><span class="pl">📊 Sorties</span>`;
    h+=pRF('reg_sp','Registre SP actif (RF)',p.reg_sp||'RF5');
    h+=pTxt('out_jour',  'Variable DV JOUR (bool)',   p.out_jour||'');
    h+=pTxt('out_vac_dv','Variable DV VAC (bool)',    p.out_vac_dv||'');
    h+=pTxt('out_actif', 'Variable DV ACTIF ce jour', p.out_actif||'');
    h+=`<div style="color:#40c4ff;font-size:9px;padding:4px 0;line-height:1.6">
      Port <b>EN</b>=enable · <b>VAC</b>=forcer vacances<br>
      <b>JOUR</b>=plage active · <b>SP_ACT</b>=reg RF · <b>ACTIF</b>=jour actif</div>`;

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
    // Registres : affichés en lecture seule si auto-assignés (RF>=100), éditables sinon
    const _rfInfo = (rf,lbl)=>{
      const isAuto = rf && rf.startsWith('RF') && parseInt(rf.slice(2))>=100;
      return `<div class="pr"><span class="pl">${lbl}</span>
        <div style="color:${isAuto?'#50ff50':'#d29922'};font-family:monospace;font-size:11px">
          ${rf||'<i style="color:var(--fbd-text3)">câbler le port</i>'}</div></div>`;
    };
    h+=_rfInfo(b.params.reg_starts,'→ nb démarrages (RF)');
    h+=_rfInfo(b.params.reg_total, '→ heures totales (RF)');
    h+=_rfInfo(b.params.reg_runtime,'→ session (s) (RF)');
    h+=`<div style="color:#50ff50;font-size:9px;padding:4px 0;line-height:1.6;border-top:1px solid var(--fbd-border);margin-top:4px">
      ✓ Les registres RF sont assignés <b>automatiquement</b> quand vous câblez<br>
      les ports <b>STARTS / TOTAL / RUNTIME</b> vers un widget synoptique.<br>
      <span style="color:var(--fbd-text2)">ID: ${b.id}</span></div>`;
  }else if(b.type==='BOOLEAN'){
    h+=pNum('n_in','Nb entrées (I)',b.params.n_in||4,1,6,1);
    h+=pNum('n_out','Nb sorties (O)',b.params.n_out||1,1,2,1);
    h+=`<div style="display:flex;gap:6px;margin:6px 0;">
      <label style="font-size:10px;color:var(--fbd-text2);display:flex;align-items:center;gap:4px;">
        <input type="checkbox" data-key="invert_o1" ${b.params.invert_o1?'checked':''} style="margin:0">
        O1 inversée</label>
      <label style="font-size:10px;color:var(--fbd-text2);display:flex;align-items:center;gap:4px;">
        <input type="checkbox" data-key="invert_o2" ${b.params.invert_o2?'checked':''} style="margin:0">
        O2 inversée</label>
    </div>`;
    // Table de vérité éditable
    const nIn2=Math.min(6,Math.max(1,parseInt(b.params.n_in)||4));
    const nOut2=Math.min(2,Math.max(1,parseInt(b.params.n_out)||1));
    const rows2=1<<nIn2;
    if(!b.params.truth_table||b.params.truth_table.length!==rows2){
      b.params.truth_table=Array.from({length:rows2},()=>Array.from({length:nOut2},()=>0));
    }
    let tt=b.params.truth_table;
    let tbl=`<div style="margin-top:8px;overflow-x:auto;max-height:220px;overflow-y:auto;">
      <table style="border-collapse:collapse;font-family:monospace;font-size:10px;width:100%">
      <tr style="background:var(--fbd-bg3)">`;
    for(let i=1;i<=nIn2;i++) tbl+=`<th style="padding:2px 5px;color:#58a6ff;border:1px solid var(--fbd-border)">I${i}</th>`;
    tbl+=`<th style="padding:2px 5px;color:var(--fbd-border);border:1px solid var(--fbd-border)">│</th>`;
    for(let o=1;o<=nOut2;o++) tbl+=`<th style="padding:2px 5px;color:#3fb950;border:1px solid var(--fbd-border)">O${o}</th>`;
    tbl+='</tr>';
    for(let r=0;r<rows2;r++){
      const rowBg=r%2===0?'var(--fbd-bg2)':'var(--fbd-bg3)';
      tbl+=`<tr style="background:${rowBg}">`;
      for(let i=0;i<nIn2;i++){
        const v=(r>>i)&1;
        tbl+=`<td style="padding:2px 5px;text-align:center;color:${v?'#3fb950':'var(--fbd-text3)'};border:1px solid var(--fbd-border)">${v}</td>`;
      }
      tbl+=`<td style="padding:2px 5px;border:1px solid var(--fbd-border);color:var(--fbd-border)">│</td>`;
      for(let o=0;o<nOut2;o++){
        const ov=tt[r]&&tt[r][o]!=null?tt[r][o]:0;
        tbl+=`<td style="padding:2px 5px;text-align:center;cursor:pointer;font-weight:bold;
          color:${ov?'#3fb950':'var(--fbd-text3)'};border:1px solid var(--fbd-border);
          background:${ov?'#0a2010':'transparent'}"
          onclick="window.toggleBoolCell('${b.id}',${r},${o})">${ov}</td>`;
      }
      tbl+='</tr>';
    }
    tbl+='</table></div>';
    h+=tbl;
  }

  // ── Panneau "Connexions RF auto" ─────────────────────────────────────────
  const _autoRFs = Object.entries(b.params||{}).filter(([k,v])=>
    typeof v==='string' && v.startsWith('RF') && parseInt(v.slice(2))>=100
  );
  if(_autoRFs.length){
    h+=`<hr class="psep"><div style="font-size:9px;color:var(--fbd-text2);margin-bottom:2px">📡 Registres câblés auto</div>
      <div style="font-family:monospace;font-size:10px;line-height:1.8">`;
    _autoRFs.forEach(([k,v])=>{
      h+=`<div><span style="color:var(--fbd-text3)">${k}</span> → <span style="color:#50ff50">${v}</span></div>`;
    });
    h+=`</div>`;
  }
  // ── Fin panneau RF ────────────────────────────────────────────────────────

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
      const PIN_KEYS = ['pin','pin_inc','pin_dec'];
      const rawVal = el.type==='number'||el.type==='range' ? Number(el.value)
                   : PIN_KEYS.includes(k) ? parseInt(el.value)
                   : el.value;
      b.params[k] = rawVal;
      // Auto-sync nom quand le pin change (INPUT / OUTPUT / CONTACTOR)
      if(k==='pin' && ['INPUT','OUTPUT','CONTACTOR'].includes(b.type)){
        const autoName = GPIO_NAMES[rawVal] || ('GPIO'+rawVal);
        b.params.name = autoName;
        // Rafraîchir le champ name dans le panneau latéral
        const nameEl = document.getElementById('props-body').querySelector('[data-key="name"]');
        if(nameEl) nameEl.value = autoName;
      }
      notifyChange(); render();
      if(b.type==='PAGE_IN'||b.type==='PAGE_OUT'||b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX') showBlockProps(b);
      if(b.type==='BOOLEAN')  { updPortsBoolean(b);  notifyChange(); render(); showBlockProps(b); return; }
      if(b.type==='CARITHM') { updPortsCarithm(b); render(); }
      if(b.type==='PYBLOCK')  { updPortsPyblock(b);  render(); }
    });
  });

  // Curseur simulation analogique (PT_IN / ANA_IN / DS_IN)
  const simSlider=document.getElementById(`sim_val_${b.id}`);
  if(simSlider){
    simSlider.addEventListener('input',e=>{
      const val=parseFloat(e.target.value);
      b._simVal=val;
      const lbl=document.getElementById(`sim_lbl_${b.id}`);
      if(lbl) lbl.textContent=(b.type==='PT_IN'||b.type==='DS_IN')?val.toFixed(1)+'°C':val.toFixed(3)+'V';
      if(window.pybridge){
        const ref=b.params.analog_ref||(b.type==='PT_IN'?'PT0':b.type==='DS_IN'?'DS0':'ANA0');
        // DS18B20 est un capteur numérique : pas de tension à simuler,
        // on force directement la température (comme le forçage °C existant).
        if(b.type==='DS_IN') window.pybridge.set_analog_celsius(ref, val);
        else window.pybridge.set_analog_sim(ref, val);
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
    <button class="pb" style="background:#0d2016;color:#3fb950;border:1px solid #238636;margin-bottom:4px"
      onclick="replaceWireWithCONN(selW)">⊙ Remplacer par CONN</button>
    <button class="pb danger" onclick="delSel()">✕ Supprimer</button>`;
}

// ────────────────────────────────────────────────────────────
// Numéro CONN libre (sur toutes les pages)
// ────────────────────────────────────────────────────────────
function _nextConnNum(){
  let max=0;
  pages.forEach(p=>p.blocks.forEach(b=>{
    if(b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX'){const n=parseInt(b.params.num)||0;if(n>max)max=n;}
  }));
  return max+1;
}

// ────────────────────────────────────────────────────────────
// Remplace un fil sélectionné par une paire de blocs CONN
// ────────────────────────────────────────────────────────────
function replaceWireWithCONN(w){
  if(!w)return;
  const p=pg();
  const srcBlock=p.blocks.find(b=>b.id===w.src.bid);
  const dstBlock=p.blocks.find(b=>b.id===w.dst.bid);
  if(!srcBlock||!dstBlock)return;

  const srcPortObj=srcBlock.ports_out.find(pp=>pp.name===w.src.port);
  const dstPortObj=dstBlock.ports_in.find(pp=>pp.name===w.dst.port);
  if(!srcPortObj||!dstPortObj)return;

  const num=_nextConnNum();
  const label=`C${num}`;
  pushUndo();

  // Supprimer le fil original
  _releaseWireRF(p, w);
  p.wires=p.wires.filter(x=>x!==w);

  const connH=computeH('CONN');

  // CONN "sortie" : juste à droite du bloc source
  const aBid=`B${idCtr++}`;
  const aBlock={
    id:aBid, type:'CONN',
    x:sn(srcBlock.x+srcBlock.w+20),
    y:sn(srcPortObj.y - connH/2),
    w:BW, h:connH,
    params:{num, label}, ports_in:[], ports_out:[], active:false
  };
  updPorts(aBlock);
  p.blocks.push(aBlock);

  // CONN "entrée" : juste à gauche du bloc destination
  const bBid=`B${idCtr++}`;
  const bBlock={
    id:bBid, type:'CONN',
    x:sn(dstBlock.x - BW - 20),
    y:sn(dstPortObj.y - connH/2),
    w:BW, h:connH,
    params:{num, label}, ports_in:[], ports_out:[], active:false
  };
  updPorts(bBlock);
  p.blocks.push(bBlock);

  // Fil : source → IN du premier CONN
  const w1={id:`W${idCtr++}`,src:{bid:w.src.bid,port:w.src.port},dst:{bid:aBid,port:'IN'}};
  recalcW(w1); p.wires.push(w1);
  _assignWireRF(p, w.src.bid, w.src.port, aBid, 'IN');

  // Fil : OUT du second CONN → destination
  const w2={id:`W${idCtr++}`,src:{bid:bBid,port:'OUT'},dst:{bid:w.dst.bid,port:w.dst.port}};
  recalcW(w2); p.wires.push(w2);
  _assignWireRF(p, bBid, 'OUT', w.dst.bid, w.dst.port);

  selW=null; selB=null; showEmptyProps();
  notifyChange(); render();
}

// ────────────────────────────────────────────────────────────
// Crée une paire de blocs CONN entre deux ports (sans fil préexistant)
// ────────────────────────────────────────────────────────────
function addConnPair(sBid,sPort,dBid,dPort){
  const p=pg();
  const srcBlock=p.blocks.find(b=>b.id===sBid);
  const dstBlock=p.blocks.find(b=>b.id===dBid);
  if(!srcBlock||!dstBlock)return;

  const srcPortObj=srcBlock.ports_out.find(pp=>pp.name===sPort);
  const dstPortObj=dstBlock.ports_in.find(pp=>pp.name===dPort);
  if(!srcPortObj||!dstPortObj)return;

  const num=_nextConnNum();
  const label=`C${num}`;
  pushUndo();

  const connH=computeH('CONN');

  // CONN côté source
  const aBid=`B${idCtr++}`;
  const aBlock={
    id:aBid, type:'CONN',
    x:sn(srcBlock.x+srcBlock.w+20),
    y:sn(srcPortObj.y - connH/2),
    w:BW, h:connH,
    params:{num, label}, ports_in:[], ports_out:[], active:false
  };
  updPorts(aBlock);
  p.blocks.push(aBlock);

  // CONN côté destination
  const bBid=`B${idCtr++}`;
  const bBlock={
    id:bBid, type:'CONN',
    x:sn(dstBlock.x - BW - 20),
    y:sn(dstPortObj.y - connH/2),
    w:BW, h:connH,
    params:{num, label}, ports_in:[], ports_out:[], active:false
  };
  updPorts(bBlock);
  p.blocks.push(bBlock);

  // Fil : source → IN du CONN source
  const w1={id:`W${idCtr++}`,src:{bid:sBid,port:sPort},dst:{bid:aBid,port:'IN'}};
  recalcW(w1); p.wires.push(w1);
  _assignWireRF(p, sBid, sPort, aBid, 'IN');

  // Fil : OUT du CONN destination → destination
  const w2={id:`W${idCtr++}`,src:{bid:bBid,port:'OUT'},dst:{bid:dBid,port:dPort}};
  recalcW(w2); p.wires.push(w2);
  _assignWireRF(p, bBid, 'OUT', dBid, dPort);

  selW=null; selB=null; showEmptyProps();
  notifyChange(); render();
}

function pSel(k,l,v,opts){
  // Si la valeur actuelle n'est pas dans la liste, l'ajouter en tête
  const hasVal = opts.some(o=>String(o.v)===String(v));
  const safeOpts = hasVal ? opts : [{v:v, l:`${v} ★ auto`}, ...opts];
  return`<div class="pr"><span class="pl">${l}</span>
    <select class="ps" data-key="${k}">${safeOpts.map(o=>`<option value="${o.v}" ${String(o.v)===String(v)?'selected':''}>${o.l}</option>`).join('')}</select></div>`;
}
// Datalist RF partagé — généré UNE seule fois (évite 256 options × N calls = gel WebView)
const _RF_DL_ID = 'rf-global-datalist';
function _ensureRFDatalist(){
  if(!document.getElementById(_RF_DL_ID)){
    const dl=document.createElement('datalist');
    dl.id=_RF_DL_ID;
    for(let i=0;i<512;i++){const o=document.createElement('option');o.value=`RF${i}`;dl.appendChild(o);}
    document.body.appendChild(dl);
  }
}
function pRF(k,l,v){
  // Champ texte libre + datalist partagé RF0..RF511
  _ensureRFDatalist();
  return`<div class="pr"><span class="pl">${l}</span>
    <input class="pi" type="text" list="${_RF_DL_ID}" data-key="${k}" value="${v||'RF0'}"
      placeholder="RF0…RF511 ou plus" style="width:100%;box-sizing:border-box"></div>`;
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
      if((ob.type==='CONN'||ob.type==='CONN_TX'||ob.type==='CONN_RX')&&ob.params.num===num)
        res.push({num,label:ob.params.label||'',pageName:pg.name,pageIdx:i,bid:ob.id,btype:ob.type});
    });
  });
  return res;
}

// ════════════════════════════════════════════════════════════
// FIT VIEW
// ════════════════════════════════════════════════════════════
function fitView(){
  // FIX: si le canvas n'a pas encore de taille (transition Qt), reporter à la prochaine frame
  if(cvs.width<10||cvs.height<10){requestAnimationFrame(fitView);return;}
  const p=pg();if(!p||!p.blocks.length){vp.x=40;vp.y=40;vp.scale=1;drawGrid();render();return;}
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  // FIX: ignorer les blocs avec coordonnées manquantes/NaN pour éviter la propagation de NaN
  p.blocks.forEach(b=>{
    if(b.x==null||b.y==null||isNaN(b.x)||isNaN(b.y)||isNaN(b.w)||isNaN(b.h))return;
    x0=Math.min(x0,b.x);y0=Math.min(y0,b.y);x1=Math.max(x1,b.x+b.w);y1=Math.max(y1,b.y+b.h);
  });
  // FIX: si aucun bloc valide trouvé, vue par défaut
  if(!isFinite(x0)||!isFinite(y0)||!isFinite(x1)||!isFinite(y1)){vp.x=40;vp.y=40;vp.scale=1;drawGrid();render();return;}
  const W=cvs.width-60,H=cvs.height-60;
  // FIX: zoom min 0.1 pour les grandes pages (PYBLOCK avec beaucoup d'entrées)
  vp.scale=Math.max(.1,Math.min(Math.min(W/(x1-x0+80),H/(y1-y0+80)),2.5));
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


// ════════════════════════════════════════════════════════════
// MIGRATION MULTI-PAGES → CANVAS INFINI
// Résout PAGE_OUT/PAGE_IN en fils RF directs et dispose chaque
// ancienne page comme une section horizontale avec cartouche.
// ════════════════════════════════════════════════════════════
function _migrateToSingleCanvas(data){
  const PAGE_GAP   = 2400;  // px entre les sections
  const COL_WIDTH  = 1800;  // largeur estimée d'une section
  const CART_H     = 160;   // hauteur cartouche
  const CART_W     = 1600;  // largeur cartouche
  const CART_PAD   = 40;    // marge sous les blocs

  const realPages  = data.pages.filter(p=>!p.id.startsWith('__grp_'));
  const grpPages   = data.pages.filter(p=> p.id.startsWith('__grp_'));

  let allBlocks = [];
  let allWires  = [];
  let maxId     = 1;

  // Collecter tous les RF déjà assignés (PAGE_OUT→source) pour
  // construire une map signal→RF et ainsi créer des fils virtuels
  // propres sans passer par le compilateur.
  const signalRF = {};   // signal_name → RF string (depuis params.reg_out du src)
  const sigSrcRF = {};   // signal_name → {bid, port} côté source réelle

  // ── Passe 1 : disposition spatiale + collecte signaux ──────────
  realPages.forEach((pg, pi) => {
    const offsetX = pi * PAGE_GAP;
    // Centrer verticalement (les blocs peuvent avoir des y négatifs)
    const ys = pg.blocks.map(b=>b.y||0);
    const minY = ys.length ? Math.min(...ys) : 0;
    const offsetY = minY < 0 ? -minY + 80 : 80;

    pg.blocks.forEach(b => {
      b.x = (b.x||0) + offsetX;
      b.y = (b.y||0) + offsetY;
      const n = parseInt((b.id||'').replace(/\D/g,''));
      if (!isNaN(n) && n > maxId) maxId = n + 1;
    });

    // Identifier PAGE_OUT : récupérer le RF déjà dans params
    pg.blocks.forEach(b => {
      if (b.type === 'PAGE_OUT') {
        const sig = (b.params||{}).signal||'';
        if (!sig) return;
        // Trouver le fil entrant → bloc source
        const inWire = pg.wires.find(w => w.dst && w.dst.bid === b.id);
        if (inWire) {
          sigSrcRF[sig] = { bid: inWire.src.bid, port: inWire.src.port };
          // Si le bloc source a déjà un reg_out (assigné par _assignWireRF)
          const srcBlk = pg.blocks.find(bb => bb.id === inWire.src.bid);
          if (srcBlk) {
            const rf = (srcBlk.params||{}).reg_out;
            if (rf) signalRF[sig] = rf;
          }
        }
      }
    });
  });

  // ── Passe 2 : fils virtuels PAGE_IN → consommateurs ────────────
  // On ajoute des fils directs src.bid:src.port → dst.bid:dst.port
  const extraWires = [];
  let wireId = maxId + 10000;

  realPages.forEach(pg => {
    pg.blocks.forEach(b => {
      if (b.type === 'PAGE_IN') {
        const sig = (b.params||{}).signal||'';
        const src = sigSrcRF[sig];
        if (!src) return;
        // Fil sortant du PAGE_IN
        const outWires = pg.wires.filter(w => w.src && w.src.bid === b.id);
        outWires.forEach(ow => {
          extraWires.push({
            id: `WM${wireId++}`,
            src: { bid: src.bid, port: src.port },
            dst: { bid: ow.dst.bid, port: ow.dst.port }
          });
        });
      }
    });
  });

  // ── Passe 3 : filtrer blocs/fils PAGE_IN/PAGE_OUT ──────────────
  realPages.forEach(pg => {
    const pageInOutIds = new Set(
      pg.blocks.filter(b => b.type==='PAGE_IN'||b.type==='PAGE_OUT').map(b=>b.id)
    );
    pg.blocks = pg.blocks.filter(b => b.type!=='PAGE_IN' && b.type!=='PAGE_OUT');
    pg.wires  = pg.wires.filter(w =>
      !pageInOutIds.has((w.src||{}).bid) && !pageInOutIds.has((w.dst||{}).bid)
    );
  });

  // ── Passe 4 : ajouter cartouches ───────────────────────────────
  const cartouches = [];
  realPages.forEach((pg, pi) => {
    const offsetX = pi * PAGE_GAP;
    const xs = pg.blocks.map(b=>b.x||0);
    const ys = pg.blocks.map(b=>(b.y||0)+(b.h||60));
    const x0 = xs.length ? Math.min(...xs) - 60 : offsetX;
    const y0 = 0;
    const x1 = xs.length ? Math.max(...xs) + 160 : offsetX + CART_W;
    const y1 = ys.length ? Math.max(...ys) + CART_PAD : 600;
    const cId = `BC${maxId++}`;
    cartouches.push({
      id: cId, type: 'CARTOUCHE',
      x: Math.min(x0, offsetX - 60),
      y: y0,
      w: Math.max(x1 - x0, CART_W),
      h: y1 - y0 + CART_H,
      params: {
        title: pg.name,
        subtitle: '',
        rev: '1',
        date: new Date().toISOString().slice(0,10),
        author: '',
        sheet: `${pi+1}/${realPages.length}`
      },
      ports_in:[], ports_out:[], active:false
    });
  });

  // ── Assembler ──────────────────────────────────────────────────
  realPages.forEach(pg => {
    allBlocks.push(...pg.blocks);
    allWires .push(...pg.wires);
  });
  allBlocks.push(...cartouches);
  allWires .push(...extraWires);

  return {
    pages: [
      { id:'P1', name:'Programme', blocks:allBlocks, wires:allWires },
      ...grpPages
    ],
    curPage: 0
  };
}

function loadDiagram(data){
  if(!data||!data.pages)return;
  // Initialiser le compteur RF depuis les registres existants
  _initRFCounter(data);
  // ── Migration automatique multi-pages → canvas infini ──────────
  if(data.pages && data.pages.filter(p=>!p.id.startsWith('__grp_')).length>1){
    data = _migrateToSingleCanvas(data);
  }
  pages=[];idCtr=1;
  data.pages.filter(pd=>!pd.id.startsWith('__grp_')).forEach(pd=>{
    const p={id:pd.id,name:pd.name,blocks:[],wires:[]};
    pgVP[pd.id]={x:40,y:40,scale:1};
    pd.blocks.forEach(bd=>{
      // FIX: normaliser le type en majuscules (ex: 'runtimecnt' → 'RUNTIMCNT')
      const _type = (bd.type||'').toUpperCase();
      const _params = {...defParams(_type),...bd.params};
      // h : utiliser la valeur sauvegardée si elle est explicitement > valeur calculée
      // (permet le redimensionnement manuel), sinon recalculer
      const _computedH = computeH(_type);
      const _savedH = (bd.h && bd.h > _computedH) ? bd.h : _computedH;
      const _savedW = bd.w || BW;
      // FIX: coordonnées manquantes/NaN → position par défaut pour éviter NaN dans fitView/render
      const _x = (bd.x != null && !isNaN(bd.x)) ? bd.x : 100;
      const _y = (bd.y != null && !isNaN(bd.y)) ? bd.y : 100;
      const b={id:bd.id,type:_type,x:_x,y:_y,w:_savedW,h:_savedH,
               params:_params,ports_in:[],ports_out:[],active:false};
      updPorts(b);  // updPorts recalcule h pour GROUP/CARITHM/PYBLOCK
      // Réappliquer les dimensions manuelles après updPorts si nécessaire
      if(bd.h && bd.h > computeH(_type)) { b.h=_savedH; _updPortsPos(b); }
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

let _simState={}; // dernier état de simulation reçu

// Types de blocs logiques dont le fil de sortie doit lire le bit M temp
const _LOGIC_WIRE_TYPES = new Set(['AND','OR','NOT','XOR','INV','NAND','NOR']);

// Cache: block_id → bit M temp (ex: "or1" → "M24"), envoyé par block_editor.py
let _logicMbits = {};

function updateActiveStates(state){
  if(!state||!pg())return;
  _simState=state;
  // Mémoriser la carte block→M-bit et la stocker sur chaque bloc pour drawWire
  if(state.logic_mbits){
    _logicMbits=state.logic_mbits;
    // Stocker _mbit sur chaque bloc pour lecture dans drawWire
    for(const pg2 of pages){
      for(const b of pg2.blocks){
        if(_logicMbits[b.id]) b._mbit=_logicMbits[b.id];
      }
    }
  }
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
      // ── Logique booléenne : lire le bit M temp si disponible, sinon traceActive ──
      case'AND':
      case'OR':
      case'NOT':
      case'XOR':
      case'INV':
      case'COIL':
      case'SET':
      case'RESET':
      case'SR_R':
      case'SR_S':
      case'SR':
      case'RS':
      case'MOVE':
      case'COMPH':
      case'COMPL':
      case'HYST':
      case'COMPARE_F':{
        b.active=false;
        // 1) Lecture directe du bit M temp (M24-M31) stocké par block_editor
        if(b._mbit && state.memory && state.memory[b._mbit]!==undefined){
          b.active=!!state.memory[b._mbit];
          break;
        }
        // 2) FIX: lire reg_out RF* directement dans state.registers
        //    (cas XOR/OR câblé via RF sans coil implicite)
        {
          const _ro=(b.params||{}).reg_out;
          if(_ro&&_ro.startsWith&&_ro.startsWith('RF')&&state.registers){
            const _rv=state.registers[_ro];
            if(_rv!=null){b.active=Math.abs(parseFloat(_rv))>0.01;break;}
          }
          // 3) FIX2: reg_out absent dans params → chercher dans les fils sortants
          // Le bloc canvas OR/XOR a toujours params.reg_out assigné par _assignWireRF
          // mais si absent, chercher le RF via les fils de sortie
          if(!_ro||!_ro.startsWith||!_ro.startsWith('RF')){
            for(const w of (pg().wires||[])){
              if(w.src.bid===b.id){
                const _db=pg().blocks.find(x=>x.id===w.dst.bid);
                if(_db){
                  const _dp=_db.params||{};
                  // Lire le rf de destination (a{n}_ref ou d{n}_ref)
                  const _pkey=w.dst.port.toLowerCase()+'_ref';
                  const _drf=_dp[_pkey];
                  if(_drf&&_drf.startsWith&&_drf.startsWith('RF')&&state.registers){
                    const _rv2=state.registers[_drf];
                    if(_rv2!=null){b.active=Math.abs(parseFloat(_rv2))>0.01;break;}
                  }
                }
              }
            }
          }
        }
        // Fallback : traceActive traverse blocs logiques, CONN TX/RX inter-pages, CARITHM/PYBLOCK
        function traceActive(srcId, visited, inPage){
          if(visited.has(srcId))return false;
          visited.add(srcId);
          for(const w of inPage.wires){
            if(w.src.bid!==srcId)continue;
            const dst=inPage.blocks.find(x=>x.id===w.dst.bid);
            if(!dst)continue;
            // ── GPIO sortie ──────────────────────────────────────────────
            if(dst.type==='OUTPUT'){
              const v=state.gpio&&state.gpio[String(dst.params.pin||0)];
              if(v&&v.value)return true;
              // FIX: OUTPUT sur variable (val_ref RF* ou M*)
              const vr=dst.params&&(dst.params.val_ref||dst.params.reg_out);
              if(vr&&state.registers&&vr.startsWith&&vr.startsWith('RF')){
                if(Math.abs(parseFloat(state.registers[vr]||0))>0.01)return true;
              }
              if(vr&&state.memory&&vr.startsWith&&vr.startsWith('M')){
                if(state.memory[vr])return true;
              }
            }
            // ── Bit mémoire ──────────────────────────────────────────────
            if(dst.type==='MEM'){
              if(state.memory&&state.memory[dst.params.bit])return true;
            }
            // ── Blocs logiques : récursion sur même page ─────────────────
            if(['AND','OR','NOT','XOR','INV','NAND','NOR','COIL','SET','RESET'].includes(dst.type)){
              if(traceActive(dst.id,visited,inPage))return true;
            }
            // ── CONN / CONN_TX / CONN_RX : traversée inter-pages ────────
            if(dst.type==='CONN'||dst.type==='CONN_TX'||dst.type==='CONN_RX'){
              // Continuer sur la page courante (sortie OUT du CONN)
              if(traceActive(dst.id,visited,inPage))return true;
              // Chercher le jumeau (même num) sur TOUTES les pages
              const num=dst.params&&dst.params.num;
              if(num!=null){
                for(const pg2 of pages){
                  for(const peer of pg2.blocks){
                    if(peer.id===dst.id)continue;
                    if((peer.type==='CONN'||peer.type==='CONN_TX'||peer.type==='CONN_RX')
                        && peer.params&&peer.params.num===num){
                      if(traceActive(peer.id,new Set([...visited]),pg2))return true;
                    }
                  }
                }
              }
            }
            // ── CARITHM / PYBLOCK : vérifier registres od ────────────────
            if(dst.type==='CARITHM'||dst.type==='PYBLOCK'){
              const dp=dst.params||{};
              for(let n=1;n<=8;n++){
                const rf=dp[`od${n}_ref`];
                if(!rf)continue;
                if(rf.startsWith('M')&&state.memory&&state.memory[rf])return true;
                if(state.registers&&state.registers[rf]!=null&&
                   Math.abs(parseFloat(state.registers[rf]))>0.01)return true;
              }
              // Continuer vers les sorties câblées du CARITHM/PYBLOCK
              if(traceActive(dst.id,visited,inPage))return true;
            }
          }
          return false;
        }
        b.active=traceActive(b.id,new Set(),pg());
        break;
      }
      // ── Analogique : actif si sortie non nulle ───────────────────
      case'PID':{const pid=state.pids&&state.pids[b.id];b.active=pid?Math.abs(pid.output)>0.01:false;break;}
      case'PT_IN':
      case'ANA_IN':
      case'DS_IN':
      case'SENSOR':{
        const ref=p.reg_out||p.analog_ref||'RF0';
        const rv=state.registers&&state.registers[ref];
        b.active=rv!=null&&Math.abs(parseFloat(rv))>0.01;
        break;}
      case'MQTT':{
        const refM=p.reg_out||'';
        const rvM=refM&&state.registers&&state.registers[refM];
        b.active=rvM!=null&&Math.abs(parseFloat(rvM))>0.01;
        break;}
      case'NAND':
      case'NOR':{
        b.active=false;
        const pageNNOR=pg();
        for(const w of pageNNOR.wires){
          if(w.src.bid!==b.id)continue;
          const dst=pageNNOR.blocks.find(x=>x.id===w.dst.bid);
          if(!dst)continue;
          if(dst.type==='OUTPUT'){const v=state.gpio&&state.gpio[String(dst.params.pin||0)];if(v&&v.value){b.active=true;break;}}
          if(dst.type==='MEM'){if(state.memory&&state.memory[dst.params.bit]){b.active=true;break;}}
        }
        break;
      }
      case'BOOLEAN':{
        // Actif si O1 (ou O2) est câblé sur un GPIO actif
        b.active=false;
        const pageBOOL=pg();
        for(const w of pageBOOL.wires){
          if(w.src.bid!==b.id)continue;
          const dst=pageBOOL.blocks.find(x=>x.id===w.dst.bid);
          if(!dst)continue;
          if(dst.type==='OUTPUT'){const v=state.gpio&&state.gpio[String(dst.params.pin||0)];if(v&&v.value){b.active=true;break;}}
        }
        break;
      }
      // ── CONN / CONN_TX / CONN_RX : passe 1 — sera affiné en passe 2
      //    On initialise seulement ici ; la vraie propagation est faite en passe 2
      //    pour garantir que les blocs logiques amont sont déjà calculés.
      case'CONN':
      case'CONN_TX':
      case'CONN_RX':{
        b.active=false; // sera calculé en passe 2
        break;
      }
      // ── Blocs analogiques (ADD, AV, AVG…) : jamais "actifs" au sens numérique
      // Le vert ne s'allume que sur les signaux numériques ON/OFF.
      // Les blocs analogiques restent neutres (pas de surbrillance verte).
      // ── CARITHM / PYBLOCK : actif si au moins un od{n}_ref est non nul
      case'CARITHM':
      case'PYBLOCK':{
        b.active=false;
        const _cp=b.params||{};
        for(let _n=1;_n<=8;_n++){
          const _rf=_cp['od'+_n+'_ref'];
          if(!_rf)continue;
          if(state.registers&&state.registers[_rf]!=null&&Math.abs(parseFloat(state.registers[_rf]))>0.01){b.active=true;break;}
          if(state.memory&&state.memory[_rf]){b.active=true;break;}
        }
        break;
      }
      default:{ b.active=false; break; }
    }
  });

  // ── CONN / CONN_TX / CONN_RX passe 2 : propager l'état aux blocs sans fil entrant
  //    Cherche le jumeau (même num) sur TOUTES les pages, pas seulement la page courante.
  //    Ex: OR → CONN_TX(-49) page1  →  CONN_RX(-49) page2 doit être actif si OR l'est.
  pages.forEach(pg2=>{
    pg2.blocks.filter(b=>b.type==='CONN'||b.type==='CONN_TX'||b.type==='CONN_RX').forEach(b=>{
      const inW=pg2.wires.find(w=>w.dst.bid===b.id&&w.dst.port==='IN');
      if(inW){
        // Ce bloc a un fil entrant : son active est déjà calculé en passe 1.
        // S'assurer que les blocs logiques amont sans OUTPUT câblé sont bien propagés.
        const src=pg2.blocks.find(x=>x.id===inW.src.bid);
        if(src) b.active=!!src.active;
      } else {
        // Pas de fil entrant : chercher le pair (même num) sur TOUTES les pages
        const num=b.params&&b.params.num;
        if(num==null)return;
        let peerActive=false;
        for(const pg3 of pages){
          const peer=pg3.blocks.find(x=>
            x.id!==b.id&&
            (x.type==='CONN'||x.type==='CONN_TX'||x.type==='CONN_RX')&&
            x.params&&x.params.num===num&&
            pg3.wires.some(w=>w.dst.bid===x.id&&w.dst.port==='IN'));
          if(peer){peerActive=!!peer.active;break;}
        }
        b.active=peerActive;
      }
    });
  });

  render();
}

// ── toggleBoolCell : bascule une cellule de la table de vérité BOOLEAN ──────
window.toggleBoolCell = function(bid, row, col){
  const p2=pg(); if(!p2) return;
  const b2=p2.blocks.find(x=>x.id===bid); if(!b2) return;
  pushUndo();
  const tt2=b2.params.truth_table;
  if(tt2&&tt2[row]!=null){
    tt2[row][col]=tt2[row][col]?0:1;
    notifyChange(); render();
    if(selB&&selB.id===bid) showBlockProps(b2);
  }
};

function notifyChange(){
  if(window.pybridge)window.pybridge.on_diagram_changed(JSON.stringify(getDiagram()));
  setTimeout(showValidationResults, 200);
}


// ════════════════════════════════════════════════════════════
// AJOUT D'UN CARTOUCHE
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// IMPRESSION D'UNE ZONE CARTOUCHE
// ════════════════════════════════════════════════════════════
function _printCartouche(bid){
  const p = pg(); if(!p) return;
  const b = p.blocks.find(bl=>bl.id===bid);
  if(!b) return;

  // Sauvegarder viewport
  const savedVP = {...vp};

  // Calculer le scale pour que b rentre dans la fenêtre
  const scaleX = (cvs.width  * 0.92) / b.w;
  const scaleY = (cvs.height * 0.92) / b.h;
  const printScale = Math.min(scaleX, scaleY);

  vp.scale = printScale;
  vp.x = cvs.width/2  - (b.x + b.w/2) * printScale;
  vp.y = cvs.height/2 - (b.y + b.h/2) * printScale;
  drawGrid(); render();

  // Capture canvas → nouvelle fenêtre → print
  const dataUrl = cvs.toDataURL('image/png');
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${b.params.title||'Impression'}</title>
    <style>
      body{margin:0;padding:0;background:#fff;}
      img{width:100%;height:auto;display:block;}
      @media print{
        @page{size:A3 landscape;margin:5mm;}
        body{margin:0;}
      }
    </style>
  </head><body>
    <img src="${dataUrl}">
    <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  win.document.close();

  // Restaurer viewport
  setTimeout(()=>{
    vp.x=savedVP.x; vp.y=savedVP.y; vp.scale=savedVP.scale;
    drawGrid(); render();
  }, 500);
}

function addCartouche(){
  const p = pg(); if(!p) return;
  pushUndo();
  // Positionner au centre de la vue actuelle
  const cx = (cvs.width/2  - vp.x) / vp.scale;
  const cy = (cvs.height/2 - vp.y) / vp.scale;
  const bid = `B${idCtr++}`;
  const blk = {
    id: bid, type:'CARTOUCHE',
    x: Math.round(cx - 800), y: Math.round(cy - 300),
    w: 1600, h: 800,
    params:{
      title: 'Nouvelle section',
      subtitle: '',
      rev: '1',
      date: new Date().toISOString().slice(0,10),
      author: '',
      sheet: `${p.blocks.filter(b=>b.type==='CARTOUCHE').length+1}`
    },
    ports_in:[], ports_out:[], active:false
  };
  p.blocks.unshift(blk);   // mettre en arrière-plan
  selB = blk;
  notifyChange(); render(); showBlockProps(blk);
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
      if(b.type==='INPUT'){
        b.params.pin = parseInt(b.params.pin);  // normalise string→int (bug select onchange)
        if(!GPIO_IN.includes(b.params.pin)){
          b.params.pin = GPIO_IN[0] || b.params.pin;
          b.params.name = GPIO_NAMES[b.params.pin] || ('GPIO'+b.params.pin);
          updated++;
        }
      }
      if(b.type==='OUTPUT'){
        b.params.pin = parseInt(b.params.pin);  // normalise string→int (bug select onchange)
        if(!GPIO_OUT.includes(b.params.pin)){
          b.params.pin = GPIO_OUT[0] || b.params.pin;
          b.params.name = GPIO_NAMES[b.params.pin] || ('GPIO'+b.params.pin);
          updated++;
        }
      }
    });
  });
  if(updated > 0){
    notifyChange();
    render();
  }
  return {GPIO_IN, GPIO_OUT, updated};
}

window.fbdAPI={loadDiagram,getDiagram,importBlocks,updateActiveStates,fitView,clearAll,addPage,addCartouche,setGridSize,toggleSnap,undo,redo,setGpioConfig,exportGroupToLibrary,importGroupFromLibrary,getGroupLibrary:()=>_groupLibrary,initCanvas:_initCanvas};

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

    // 5. (PAGE_OUT/PAGE_IN supprimés — canvas infini)

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
  // Auto-sync du nom quand le pin change
  if(key === 'pin' && ['INPUT','OUTPUT','CONTACTOR'].includes(b.type)){
    const pinInt = parseInt(value);
    b.params.pin = pinInt;
    b.params.name = GPIO_NAMES[pinInt] || ('GPIO'+pinInt);
  }
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
      // Les clés 'pin*' sont des entiers GPIO — parseInt évite le bug string vs number
      const PIN_KEYS = ['pin','pin_inc','pin_dec'];
      const val = (el.type==='number'||el.type==='range') ? Number(el.value)
                : PIN_KEYS.includes(k) ? parseInt(el.value)
                : el.value;
      b.params[k] = val;
      // Auto-sync du nom quand le pin change pour INPUT / OUTPUT / CONTACTOR
      if(k === 'pin' && ['INPUT','OUTPUT','CONTACTOR'].includes(b.type)){
        const autoName = GPIO_NAMES[val] || ('GPIO'+val);
        b.params.name = autoName;
        // Mettre à jour le champ name visible dans le panneau
        const nameEl = targetDiv.querySelector('[data-key="name"]');
        if(nameEl) nameEl.value = autoName;
        // Mettre à jour le titre de la modale (bem-name)
        const bemName = document.getElementById('bem-name');
        if(bemName) bemName.textContent = autoName;
      }
      if(b.type==='BOOLEAN')  { updPortsBoolean(b); notifyChange(); render();
        if(window.bemRefreshParams) window.bemRefreshParams(b.id); }
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


