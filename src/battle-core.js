/* ---------------------------------------------------------------------------
 * GayDex battle engine — CANONICAL GAMEPLAY AUTHORITY.
 *
 * Everything that decides who wins, how hard a hit lands, how Hype, Flow,
 * Guard fatigue, READ LOCK, counters, arena pulses, openers, CPU profiles and
 * seeded determinism behave lives here and nowhere else.
 *
 * This module is DOM-free by design: it never touches document, canvas,
 * Three.js or the Circuit world.  The Three.js layer consumes its state and
 * events; it must never recompute them.
 *
 * Provenance: the bodies below are byte-identical to the pre-Circuit engine
 * shipped in commit cbbe7a32f557f5a4e30424b8df35a79b82a2cf6e, except for five
 * presentation-context reads (scene / arenaEffects / intro / cpuSkill) that are
 * now supplied through `ctx` so this file needs no globals.  Verify with:
 *
 *     node tools/extract-original-engine.mjs
 *     node --test tests/battle-equivalence.test.mjs
 * ------------------------------------------------------------------------ */
(function (root) {
  'use strict';

  /**
   * Live context owned by the application layer.  `app.js` binds its own
   * `battleState` object here, so the engine reads the user's real arena,
   * arena-effects, opener and CPU-profile choices without importing them.
   * Determinism is unaffected: `makeBattleMatch` copies scene/arenaEffects
   * onto the match, and openers are resolved from the match seed.
   */
  let ctx = { scene: 'prism', intro: 'sweep', arenaEffects: true, cpuSkill: 'rival' };

  const BATTLE_LINES={
   Twink:{main:['twink','twank','twunk','mega-twunk'],variant:'elder-twink'},
   Cub:{main:['cub','cob','bear','mega-bear'],variant:'polar-bear'},
   Otter:{main:['twink-otter','otter','mature-otter','mega-otter'],variant:'silver-otter'},
   Independent:{main:['jock','daddy','silver-daddy','average-guy'],variant:null}
  };
  const BATTLE_MOVES={flex:{name:'Flex',type:'force',hint:'Force · beats Serve'},serve:{name:'Serve',type:'style',hint:'Style · beats Read'},read:{name:'Read',type:'insight',hint:'Insight · beats Flex'},guard:{name:'Guard',type:'guard',hint:'Grit · reduces damage'},signature:{name:'Signature',type:'signature',hint:'Lineage technique'}};
  const BATTLE_COUNTER={flex:'serve',serve:'read',read:'flex'};
  const BATTLE_SCENE_RULES={
   prism:{name:'Prediction lattice',short:'INSIGHT +5% · counters +6 Hype · pulse rewards Flow',type:'insight',mult:1.05,counterHype:6,guardShield:0,hypeOnHit:0,counterShield:0},
   aqua:{name:'Flow state',short:'STYLE +5% · Guard +3 shield · pulse shields both',type:'style',mult:1.05,counterHype:0,guardShield:3,hypeOnHit:0,counterShield:0},
   pride:{name:'Crowd circuit',short:'STYLE +4% · attacks +4 Hype · pulse charges Hype',type:'style',mult:1.04,counterHype:0,guardShield:0,hypeOnHit:4,counterShield:0},
   forest:{name:'Grounded pressure',short:'FORCE +4% · counters +3 shield · pulse protects underdog',type:'force',mult:1.04,counterHype:0,guardShield:0,hypeOnHit:0,counterShield:3}
  };
  const BATTLE_PULSE_FORECAST={prism:'Higher Flow gains +10 Hype; tied Flow gives both +5.',aqua:'Both fighters gain +6 shield.',pride:'Both fighters gain +10 Hype.',forest:'Lower HP ratio gains +10 shield and +4 Hype.'};
  const BATTLE_OPENER_RULES={
   sweep:{name:'Rival Sweep',short:'fastest fighter starts +15 Hype'},
   drop:{name:'Holo Drop',short:'both fighters start +8 shield'},
   burst:{name:'Stadium Burst',short:'both fighters start +18 Hype'}
  };
  function moveThatBeats(move){return Object.keys(BATTLE_COUNTER).find(k=>BATTLE_COUNTER[k]===move)||null}
  function sceneRule(scene=ctx.scene){return BATTLE_SCENE_RULES[scene]||BATTLE_SCENE_RULES.prism}
  function resolvedBattleOpener(seed){let op=ctx.intro;if(op==='random')op=['sweep','drop','burst'][seed%3];return op}
  function applyBattleOpener(match){let op=resolvedBattleOpener(match.seed);match.opener=op;let r=BATTLE_OPENER_RULES[op];if(op==='sweep'){let da=match.a.stats.speed-match.b.stats.speed;if(da===0){match.a.hype=8;match.b.hype=8}else (da>0?match.a:match.b).hype=15}else if(op==='drop'){match.a.shield=8;match.b.shield=8}else if(op==='burst'){match.a.hype=18;match.b.hype=18}match.log.push(`OPENING // ${r.name.toUpperCase()} // ${r.short}`);return op}
  function battleArenaPulse(match){if(!match.arenaEffects||match.ended||match.round%3!==0)return null;let a=match.a,b=match.b,scene=match.scene,text='',type='insight';if(scene==='prism'){type='insight';if(a.combo===b.combo){a.hype=Math.min(100,a.hype+5);b.hype=Math.min(100,b.hype+5);text='PRISM PULSE // matched Flow // both +5 Hype'}else{let f=a.combo>b.combo?a:b;f.hype=Math.min(100,f.hype+10);text=`PRISM PULSE // ${f.entry.name} owns the pattern // +10 Hype`}}else if(scene==='aqua'){type='style';a.shield=Math.min(34,a.shield+6);b.shield=Math.min(34,b.shield+6);text='AQUA PULSE // pressure equalizes // both +6 shield'}else if(scene==='pride'){type='style';a.hype=Math.min(100,a.hype+10);b.hype=Math.min(100,b.hype+10);text='CROWD SURGE // the circuit detonates // both +10 Hype'}else{type='force';let fa=a.hp/a.maxHp<=b.hp/b.maxHp?a:b;fa.shield=Math.min(34,fa.shield+10);fa.hype=Math.min(100,fa.hype+4);text=`EMERALD RELAY // ${fa.entry.name} gets the underdog relay // +10 shield · +4 Hype`}if(!match.fastSim)match.log.push(text);return match.fastSim?null:{kind:'arena',type,text}}
  function hashSeed(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
  function seededRng(seed){let a=seed>>>0;return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296}}
  function battleStats(e,balanced=true){let raw=e.stats.map(Number),sum=raw.reduce((a,b)=>a+b,0),scale=balanced&&sum?300/sum:1,s=raw.map(v=>v*scale),[y,p,h,m,v]=s;let d={y,p,h,m,v,maxHp:Math.round(116+p*.17+m*.13+h*.09),force:42+p*.58+m*.08,style:42+v*.58+y*.08,insight:42+m*.40+v*.25,armor:34+h*.27+m*.28+p*.08,speed:34+y*.49+v*.16,crit:Math.min(.22,.04+(y+v)/1150)};
   let st=String(e.stage);if(st.includes('Starter')){d.speed+=7}else if(st==='Stage II'){d.force+=2;d.style+=2;d.insight+=2}else if(st==='Stage III'){d.armor+=6}else if(st==='Mega'){d.force+=5;d.style+=5;d.insight+=5;d.speed-=3}else if(st.includes('Silver')){d.armor+=8;d.speed-=4;d.crit+=.015}else if(st==='Variant'){d.insight+=6}
   if(e.line==='Twink'){d.speed+=5;d.style+=3;d.armor-=1}else if(e.line==='Cub'){d.maxHp+=7;d.armor+=4}else if(e.line==='Otter'){d.maxHp+=4;d.insight+=6;d.speed+=4;d.armor+=5}else if(e.line==='Independent'){let key=['force','style','insight'].sort((a,b)=>d[b]-d[a])[0];d[key]+=4}
   return d}
  function stagePassive(e){let s=e.stage;if(String(s).includes('Starter'))return ['Fresh Legs','+tempo at the opening bell'];if(s==='Stage II')return ['Adapted','small boost across all attacks'];if(s==='Stage III')return ['Established','extra armor and composure'];if(s==='Mega')return ['Overdrive','higher offense; signature causes recoil'];if(String(s).includes('Silver'))return ['Silvered','more armor, less tempo'];if(s==='Variant')return ['Branch Form','extra insight'];if(s==='Side Species')return ['Exhibition','specialist outside the main lineage ladder'];return ['Unclassified','no lineage destiny required']}
  function lineagePassive(e){if(e.line==='Twink')return 'TEMPO: faster and stronger on style.';if(e.line==='Cub')return 'ANCHOR: more HP/armor and stronger Guard.';if(e.line==='Otter')return 'ADAPT: repeated attack types lose bite.';return 'WILD CARD: strongest attack gets a small boost.'}
  function signatureSpec(f,rng){if(f.entry.stage==='Mega'){let types=['force','style','insight'].sort((a,b)=>f.stats[b]-f.stats[a]);return {name:'Mega Burst',type:types[0],mult:1.22,recoil:5,hint:'Overdrive · recoil 5'}}if(f.entry.line==='Twink')return {name:'Quick Read',type:'style',mult:1.08,priority:8,shield:4,hint:'Fast style strike'};if(f.entry.line==='Cub')return {name:'Bear Hug',type:'force',mult:.98,shield:12,hint:'Force + 12 shield'};if(f.entry.line==='Otter')return {name:'Slipstream',type:'insight',mult:1.12,pierce:.32,shield:4,hint:'Insight · pierces armor · +4 shield'};let types=['force','style','insight'];return {name:'Wild Card',type:types[Math.floor(rng()*types.length)],mult:1.08,hint:'Random attack vector'}}
  function makeFighter(e,side,balanced,trackMetrics=true){let stats=battleStats(e,balanced),passive=stagePassive(e);return {side,entry:e,stats,hp:stats.maxHp,maxHp:stats.maxHp,shield:0,sigCd:0,hype:0,combo:0,lastMove:null,lastTaken:null,guardChain:0,history:[],metrics:trackMetrics?{damage:0,shielded:0,counters:0,crits:0,flowBreaks:0,guards:0,signatures:0,readLocks:0,biggest:0}:null,passive:`${passive[0]} — ${passive[1]}`,lineage:lineagePassive(e)}}
  const READ_BATTLE_POINTS = 3;
  const READ_BATTLE_MAX_EXCHANGES = 12;

  function makeBattleMatch(eA,eB,balanced,seed,fastSim=false,options={}){
   if(fastSim&&typeof fastSim==='object'){options=fastSim;fastSim=!!options.fastSim}
   const format=options?.format==='read'?'read':'classic';
   return {a:makeFighter(eA,'a',balanced,!fastSim),b:makeFighter(eB,'b',balanced,!fastSim),round:1,ended:false,winner:null,seed,rng:seededRng(seed),decisionRng:seededRng((seed^0x9e3779b9)>>>0),scene:ctx.scene,arenaEffects:ctx.arenaEffects,fastSim,format,score:format==='read'?{a:0,b:0}:null,opener:null,timeline:[],prevHpDiff:0,momentumSwing:null,log:fastSim?[]:[`MATCH // ${eA.name} vs ${eB.name}${balanced?' // BALANCED':' // RAW STATS'}${format==='read'?' // FIRST TO '+READ_BATTLE_POINTS:''}`]}
  }
  function makeReadBattleMatch(eA,eB,balanced=true,seed=1,fastSim=false){return makeBattleMatch(eA,eB,balanced,seed,fastSim,{format:'read'})}

  function attackValue(f,type){return type==='force'?f.stats.force:type==='style'?f.stats.style:f.stats.insight}
  function counterMultiplier(myMove,oppMove){if(!(myMove in BATTLE_COUNTER)||!(oppMove in BATTLE_COUNTER))return 1;if(BATTLE_COUNTER[myMove]===oppMove)return 1.28;if(BATTLE_COUNTER[oppMove]===myMove)return .82;return 1}
  function battleMoveMeta(f,move,rng){if(move!=='signature')return {name:BATTLE_MOVES[move].name,type:BATTLE_MOVES[move].type,mult:1,priority:move==='guard'?100:0,hint:BATTLE_MOVES[move].hint};let sig=signatureSpec(f,rng);return {...sig,priority:sig.priority||0}}
  function actionInitiative(f,move,meta,rng){return (meta.priority||0)+f.stats.speed+rng()*8+(f.entry.line==='Twink'&&move!=='guard'?3:0)+Math.min(6,(f.combo||0)*1.5)}
  function applyAttack(match,attacker,defender,move,oppMove,meta,rng,actedFirst,defenderPrevMove=null){
   const readMatch=match.format==='read';
   let rule=sceneRule(match.scene),arenaOn=match.arenaEffects;
   if(move==='guard'){
     attacker.guardChain=attacker.lastMove==='guard'?Math.min(4,attacker.guardChain+1):1;
     let fatigue=Math.max(0,attacker.guardChain-1),gain=(attacker.entry.line==='Cub'?10:7)+(arenaOn?(rule.guardShield||0):0);
     if(readMatch&&fatigue)gain=Math.max(2,Math.round(gain-fatigue*2.3));
     attacker.shield=Math.min(34,attacker.shield+gain);if(attacker.metrics)attacker.metrics.guards++;
     attacker.hype=Math.min(100,attacker.hype+(readMatch?Math.max(5,12-fatigue*3):Math.max(6,12-fatigue*2)));
     attacker.combo=0;attacker.lastMove='guard';attacker.history.push('guard');if(attacker.history.length>4)attacker.history.shift();
     if(match.fastSim)return null;
     return {kind:'guard',side:attacker.side,type:'guard',move,guardChain:attacker.guardChain,fatigue,shieldGain:gain,text:`${attacker.entry.name} braces behind Guard // +${gain} shield // Hype ${Math.round(attacker.hype)}%${fatigue?` // fatigue ${fatigue}`:''}.`}
   }
   attacker.guardChain=0;
   let normal=['flex','serve','read'].includes(move),type=meta.type,atk=attackValue(attacker,type),armor=defender.stats.armor*(1-(meta.pierce||0)),mult=meta.mult||1,countered=normal&&BATTLE_COUNTER[move]===oppMove,sameVector=normal&&move===oppMove,stale=normal&&attacker.lastMove===move,predicted=countered&&defenderPrevMove===oppMove;
   if(normal)mult*=counterMultiplier(move,oppMove);
   if(sameVector)mult*=.86;
   if(stale)mult*=readMatch?.85:.93;
   if(predicted&&readMatch)mult*=1.16;
   if(attacker.entry.line==='Twink'&&actedFirst)mult*=1.06;
   if(defender.entry.line==='Otter'&&defender.lastTaken===type)mult*=.84;
   if(oppMove==='guard'){
     let fatigue=Math.max(0,defender.guardChain-1),guardBase=defender.entry.line==='Cub'?.40:.52;
     mult*=Math.min(.88,guardBase+fatigue*.11);
   }
   // In the short match, variety pays off sooner; three distinct vectors cash
   // out as a visible FLOW BREAK instead of asking the player to count to four.
   const flowMax=readMatch?3:4;
   if(attacker.lastMove&&['flex','serve','read'].includes(attacker.lastMove)&&normal&&attacker.lastMove!==move)attacker.combo=Math.min(flowMax,attacker.combo+1);else attacker.combo=move==='signature'?0:1;
   let flowBurst=normal&&attacker.combo>=flowMax;if(flowBurst){mult*=readMatch?1.18:1.12;armor*=.88}
   let base=8+atk*.19-armor*.073;
   mult*=1+Math.max(0,attacker.combo-1)*(readMatch?.055:.035);
   if(arenaOn&&type===rule.type)mult*=rule.mult;
   mult*=1+Math.max(0,match.round-8)*.022;
   let critBonus=(arenaOn&&match.scene==='prism'?.01:0),jitter=.92+rng()*.16,crit=rng()<attacker.stats.crit+critBonus,dmg=Math.max(4,Math.round(base*mult*jitter*(crit?1.45:1)));
   let absorbed=Math.min(defender.shield,dmg);defender.shield-=absorbed;dmg-=absorbed;defender.hp=Math.max(0,defender.hp-dmg);defender.lastTaken=type;if(attacker.metrics){attacker.metrics.damage+=dmg;attacker.metrics.shielded+=absorbed;attacker.metrics.biggest=Math.max(attacker.metrics.biggest,dmg);if(countered)attacker.metrics.counters++;if(predicted)attacker.metrics.readLocks++;if(crit)attacker.metrics.crits++;if(flowBurst)attacker.metrics.flowBreaks++;if(move==='signature')attacker.metrics.signatures++}
   if(meta.shield)attacker.shield=Math.min(34,attacker.shield+meta.shield);if(meta.recoil)attacker.hp=Math.max(1,attacker.hp-meta.recoil);
   if(move==='signature'){attacker.hype=0;attacker.sigCd=2;attacker.combo=0}else{
     let gain=18+(crit?7:0)+(actedFirst?3:0)+(countered&&arenaOn?(rule.counterHype||0):0)+(arenaOn?(rule.hypeOnHit||0):0)+(predicted?(readMatch?10:8):0)+(flowBurst&&readMatch?5:0);
     if(attacker.hp/attacker.maxHp<.28)gain+=4;
     attacker.hype=Math.min(100,attacker.hype+gain);defender.hype=Math.min(100,defender.hype+Math.min(16,6+Math.ceil(dmg*.32)));
     if(countered&&arenaOn&&rule.counterShield)attacker.shield=Math.min(34,attacker.shield+rule.counterShield);
     if(predicted)attacker.shield=Math.min(34,attacker.shield+(readMatch?6:3));
   }
   attacker.lastMove=move;attacker.history.push(move);if(attacker.history.length>4)attacker.history.shift();
   let shownCombo=attacker.combo;if(flowBurst)attacker.combo=1;
   if(match.fastSim)return null;
   let bits=[`${attacker.entry.name} uses ${meta.name}`];if(dmg)bits.push(`for ${dmg}`);if(absorbed)bits.push(`(${absorbed} shielded)`);if(countered)bits.push(predicted?(readMatch?`READ LOCK on repeated ${BATTLE_MOVES[defenderPrevMove]?.name||defenderPrevMove}`:'READ LOCK'):'COUNTER');if(sameVector)bits.push('CLASH');if(stale)bits.push('STALE');if(crit)bits.push('CRIT');if(flowBurst)bits.push('FLOW BREAK');else if(shownCombo>1)bits.push(`FLOW x${shownCombo}`);if(meta.shield)bits.push(`+${meta.shield} shield`);if(meta.recoil)bits.push(`${meta.recoil} recoil`);if(move!=='signature')bits.push(`HYPE ${Math.round(attacker.hype)}%`);
   return {kind:'damage',side:attacker.side,type,move,name:meta.name,text:bits.join(' ')+'!',damage:dmg,crit,absorbed,combo:shownCombo,countered,predicted,readTarget:predicted?defenderPrevMove:null,sameVector,stale,flowBurst,hype:attacker.hype}
  }

  function battleRound(match,moveA,moveB){
   if(match.ended)return [];
   if(match.format==='read')return readBattleRound(match,moveA,moveB);

   // The classic analytical simulation remains byte-for-byte equivalent in
   // outcome to the original engine. The player-facing read match dispatches
   // to the short scoring format below.
   let roundNum=match.round,rng=match.rng,a=match.a,b=match.b,prevA=a.lastMove,prevB=b.lastMove,metaA=battleMoveMeta(a,moveA,rng),metaB=battleMoveMeta(b,moveB,rng),order=[{f:a,d:b,m:moveA,om:moveB,meta:metaA,defPrev:prevB},{f:b,d:a,m:moveB,om:moveA,meta:metaB,defPrev:prevA}];order.forEach(x=>x.init=actionInitiative(x.f,x.m,x.meta,rng));order.sort((x,y)=>y.init-x.init);match.lastFirst=order[0].f.side;match.lastInitiative=order.map(x=>({side:x.f.side,name:x.f.entry.name,value:Math.round(x.init)}));let events=match.fastSim?null:[];for(let i=0;i<order.length;i++){let x=order[i];if(x.f.hp<=0)continue;let ev=applyAttack(match,x.f,x.d,x.m,x.om,x.meta,rng,i===0,x.defPrev);if(!match.fastSim){events.push(ev);match.log.push(ev.text)}if(x.d.hp<=0)break}for(let f of [a,b])if(f.sigCd>0)f.sigCd--;let aliveA=a.hp>0,aliveB=b.hp>0;if(!aliveA||!aliveB||match.round>=40){match.ended=true;if(aliveA&&!aliveB)match.winner='a';else if(aliveB&&!aliveA)match.winner='b';else if(a.hp>b.hp)match.winner='a';else if(b.hp>a.hp)match.winner='b';else match.winner='draw';if(!match.fastSim){let text=match.winner==='draw'?'DRAW // nobody gets custody of the taxonomy.':`${match[match.winner].entry.name} WINS // ${match[match.winner].hp} HP remains.`;match.log.push(text);events.push({kind:'win',side:match.winner,text})}}else{let pulse=battleArenaPulse(match);if(pulse&&events)events.push(pulse);match.round++}if(!match.fastSim){let tags=events.filter(e=>e&&e.kind==='damage').map(e=>e.flowBurst?'FLOW BREAK':e.predicted?'READ LOCK':e.countered?'COUNTER':e.sameVector?'CLASH':e.crit?'CRIT':'').filter(Boolean),hpDiff=a.hp/a.maxHp-b.hp/b.maxHp,swing=Math.abs(hpDiff-match.prevHpDiff);if(!match.momentumSwing||swing>match.momentumSwing.delta)match.momentumSwing={round:roundNum,delta:swing,leader:hpDiff===0?'even':hpDiff>0?'a':'b',hpA:Math.ceil(a.hp),hpB:Math.ceil(b.hp),tag:tags[0]||`${match.lastFirst.toUpperCase()} first`};match.prevHpDiff=hpDiff;match.timeline.push({round:roundNum,moveA,moveB,first:match.lastFirst,hpA:Math.ceil(a.hp),hpB:Math.ceil(b.hp),tags});if(match.timeline.length>8)match.timeline.shift()}return events||[]
  }

  /** Prediction match: counters decide points; HP, Guard and Hype shape the set. */
  function readBattleRound(match,moveA,moveB){
   const roundNum=match.round,rng=match.rng,a=match.a,b=match.b,prevA=a.lastMove,prevB=b.lastMove;
   const metaA=battleMoveMeta(a,moveA,rng),metaB=battleMoveMeta(b,moveB,rng);
   const order=[{f:a,d:b,m:moveA,om:moveB,meta:metaA,defPrev:prevB},{f:b,d:a,m:moveB,om:moveA,meta:metaB,defPrev:prevA}];
   order.forEach(x=>x.init=actionInitiative(x.f,x.m,x.meta,rng));
   order.sort((x,y)=>y.init-x.init);
   match.lastFirst=order[0].f.side;
   match.lastInitiative=order.map(x=>({side:x.f.side,name:x.f.entry.name,value:Math.round(x.init)}));
   const events=match.fastSim?null:[];
   // In READ THE BITCH, the pulse lands at the opening of its forecast exchange.
   // This makes the visible countdown true: "PULSE THIS EXCHANGE" means now.
   if(match.arenaEffects&&match.round%3===0){const pulse=battleArenaPulse(match);if(pulse&&events)events.push(pulse)}
   for(let i=0;i<order.length;i++){
     const x=order[i];if(x.f.hp<=0)continue;
     const ev=applyAttack(match,x.f,x.d,x.m,x.om,x.meta,rng,i===0,x.defPrev);
     if(!match.fastSim){events.push(ev);match.log.push(ev.text)}
     if(x.d.hp<=0)break;
   }
   for(const f of [a,b])if(f.sigCd>0)f.sigCd--;

   let pointSide=null;
   if(BATTLE_COUNTER[moveA]===moveB)pointSide='a';
   else if(BATTLE_COUNTER[moveB]===moveA)pointSide='b';
   let pointEvent=null;
   if(pointSide){
     match.score[pointSide]++;
     match.lastPointSide=pointSide;
     const own=pointSide==='a'?moveA:moveB,opponent=pointSide==='a'?moveB:moveA;
     const lock=events?.find(e=>e&&e.kind==='damage'&&e.side===pointSide&&e.predicted);
     pointEvent={kind:'point',side:pointSide,move:own,oppMove:opponent,predicted:!!lock,readTarget:lock?.readTarget||null,point:match.score[pointSide],score:{...match.score},text:`DECISIVE EXCHANGE // ${match[pointSide].entry.name} takes the point: ${BATTLE_MOVES[own].name} beats ${BATTLE_MOVES[opponent].name} // ${match.score.a}–${match.score.b}.`};
     if(!match.fastSim){match.log.push(pointEvent.text);events.push(pointEvent)}
   }else match.lastPointSide=null;

   const aliveA=a.hp>0,aliveB=b.hp>0;
   let winner=null,finishReason=null;
   if(match.score.a>=READ_BATTLE_POINTS){winner='a';finishReason='three decisive exchanges'}
   else if(match.score.b>=READ_BATTLE_POINTS){winner='b';finishReason='three decisive exchanges'}
   else if(!aliveA||!aliveB){
     winner=aliveA&&!aliveB?'a':aliveB&&!aliveA?'b':a.hp>b.hp?'a':b.hp>a.hp?'b':'draw';
     finishReason='knockout';
   }else if(roundNum>=READ_BATTLE_MAX_EXCHANGES){
     winner=match.score.a===match.score.b?(a.hp>b.hp?'a':b.hp>a.hp?'b':'draw'):match.score.a>match.score.b?'a':'b';
     finishReason='exchange limit';
   }

   if(pointSide&&match.score[pointSide]===READ_BATTLE_POINTS-1&&!winner){
     const double=match.score.a===READ_BATTLE_POINTS-1&&match.score.b===READ_BATTLE_POINTS-1;
     const event={kind:'matchpoint',side:pointSide,score:{...match.score},text:double?'DOUBLE MATCH POINT // next decisive exchange wins.':`${match[pointSide].entry.name.toUpperCase()} AT MATCH POINT // one more decisive exchange wins.`};
     if(!match.fastSim){match.log.push(event.text);events.push(event)}
   }

   if(winner){
     match.ended=true;match.winner=winner;match.finishReason=finishReason;
     if(!match.fastSim){const text=winner==='draw'?'DRAW // no decisive exchanges; the field holds.':`${match[winner].entry.name.toUpperCase()} WINS // ${match.score.a}–${match.score.b} // ${finishReason.toUpperCase()}.`;match.log.push(text);events.push({kind:'win',side:winner,text,finishReason,score:{...match.score}})}
   }else match.round++;

   if(!match.fastSim){
     const tags=events.filter(e=>e&&e.kind==='damage').map(e=>e.predicted?'READ LOCK':e.flowBurst?'FLOW BREAK':e.countered?'COUNTER':e.sameVector?'CLASH':e.crit?'CRIT':'').filter(Boolean);
     if(pointSide)tags.push('DECISIVE POINT');
     const hpDiff=a.hp/a.maxHp-b.hp/b.maxHp,swing=Math.abs(hpDiff-match.prevHpDiff);
     if(!match.momentumSwing||swing>match.momentumSwing.delta)match.momentumSwing={round:roundNum,delta:swing,leader:hpDiff===0?'even':hpDiff>0?'a':'b',hpA:Math.ceil(a.hp),hpB:Math.ceil(b.hp),tag:tags[0]||`${match.lastFirst.toUpperCase()} first`};
     match.prevHpDiff=hpDiff;
     match.timeline.push({round:roundNum,moveA,moveB,first:match.lastFirst,hpA:Math.ceil(a.hp),hpB:Math.ceil(b.hp),tags,pointSide,scoreA:match.score.a,scoreB:match.score.b});
     if(match.timeline.length>12)match.timeline.shift();
   }
   return events||[]
  }

  function aiBattleMove(f,opp,rng,match=null){
   let ratio=f.hp/f.maxHp,oppReady=opp.sigCd===0&&opp.hype>=100;
   if(f.sigCd===0&&f.hype>=100&&rng()<.84)return 'signature';
   if(oppReady&&f.guardChain<1&&rng()<.42)return 'guard';
   if(ratio<.28&&f.guardChain<2&&rng()<.48)return 'guard';
   let recent=opp.history||[],last=recent[recent.length-1],prev=recent[recent.length-2];
   if(last&&last===prev&&BATTLE_COUNTER[last]&&rng()<.82)return moveThatBeats(last);
   if(last&&BATTLE_COUNTER[last]&&rng()<.38)return moveThatBeats(last);
   let values=[['flex',f.stats.force],['serve',f.stats.style],['read',f.stats.insight]].sort((a,b)=>b[1]-a[1]);
   if(f.combo>=2&&f.lastMove&&rng()<.68){let alt=values.find(x=>x[0]!==f.lastMove&&x[1]>=values[0][1]*.82);if(alt)return alt[0]}
   if(match?.arenaEffects??ctx.arenaEffects){let rule=sceneRule(match?.scene),stageMove=rule.type==='force'?'flex':rule.type==='style'?'serve':'read',v=values.find(x=>x[0]===stageMove);if(v&&v[1]>=values[0][1]*.84&&rng()<.32)return stageMove}
   if(f.lastMove&&['flex','serve','read'].includes(f.lastMove)&&rng()<.5){let alt=values.find(x=>x[0]!==f.lastMove&&x[1]>=values[0][1]*.86);if(alt)return alt[0]}
   if(rng()<.64)return values[0][0];return values[1+Math.floor(rng()*2)][0]
  }
  function chooseCpuBattleMove(f,opp,rng,match){
   let skill=ctx.cpuSkill||'rival',recent=opp.history||[],last=recent[recent.length-1],prev=recent[recent.length-2],values=[['flex',f.stats.force],['serve',f.stats.style],['read',f.stats.insight]].sort((a,b)=>b[1]-a[1]),move,reason='tempo read',patternChance=skill==='nemesis'?.96:skill==='trainer'?.38:.82,finish=skill==='nemesis'?.32:skill==='trainer'?.14:.22;
   if(f.sigCd===0&&f.hype>=100&&opp.hp/opp.maxHp<(skill==='nemesis'?.62:.42)){move='signature';reason=skill==='nemesis'?'signature conversion':'signature pressure'}
   else if(last&&last===prev&&BATTLE_COUNTER[last]&&rng()<patternChance){move=moveThatBeats(last);reason=skill==='nemesis'?'hard pattern read':'pattern read'}
   else if(opp.hp/opp.maxHp<finish){move=values[0][0];reason='finish window'}
   else if(skill==='trainer'&&rng()<.34){move=['flex','serve','read'][Math.floor(rng()*3)];reason='training mix'}
   else {move=aiBattleMove(f,opp,rng,match);if(move==='guard'&&f.guardChain>=2){move=values[0][0];reason='guard fatigue avoidance'}else if(match?.arenaEffects&&((match.round-1)%3===2)){let rule=sceneRule(match.scene),stageMove=rule.type==='force'?'flex':rule.type==='style'?'serve':'read',v=values.find(x=>x[0]===stageMove),chance=skill==='nemesis'?.82:skill==='trainer'?.28:.55;if(v&&v[1]>=values[0][1]*(skill==='nemesis'?.72:.82)&&rng()<chance){move=stageMove;reason=skill==='nemesis'?'pulse conversion':'arena pulse read'}}}
   return {move,reason,skill}
  }
  /**
   * Readable rival policy for the short human-facing match. It only considers
   * revealed history and public state; difficulty changes the strength of
   * habits, never fighter stats or access to the player's current choice.
   */
  function chooseReadRivalMove(f,opp,rng,match){
   const skill=ctx.cpuSkill||'rival';
   const profile={trainer:{habit:.62,repeat:.84,counter:.44,retaliate:.58,guard:.42,signature:.72},rival:{habit:.46,repeat:.68,counter:.64,retaliate:.66,guard:.52,signature:.84},nemesis:{habit:.28,repeat:.46,counter:.82,retaliate:.78,guard:.62,signature:.92}}[skill]||{habit:.46,repeat:.68,counter:.64,retaliate:.66,guard:.52,signature:.84};
   const history=opp.history||[],n=history.length,lastHuman=n?history[n-1]:null,prevHuman=n>1?history[n-2]:null;
   const rows=match?.timeline||[],previous=rows.length?rows[rows.length-1]:null;
   const cpuLast=previous?.moveB||(f.history||[]).slice(-1)[0]||null;
   const matchPoint=!!match?.score&&(match.score[f.side]>=READ_BATTLE_POINTS-1||match.score[opp.side]>=READ_BATTLE_POINTS-1);
   if(f.sigCd===0&&f.hype>=100){
     const conversion=opp.hp/opp.maxHp<.52||(matchPoint&&opp.hp/opp.maxHp<.72)||f.hp/f.maxHp<.24;
     if(conversion&&rng()<profile.signature)return {move:'signature',reason:'signature conversion',skill};
   }
   if(f.guardChain<2&&((opp.hype>=100&&opp.sigCd===0)||f.hp/f.maxHp<.28)&&rng()<profile.guard){
     return {move:'guard',reason:opp.hype>=100?'guarding a signature window':'clutch guard',skill};
   }
   if(previous?.pointSide===f.side&&cpuLast&&rng()<profile.repeat){
     return {move:cpuLast,reason:'repeats after winning a point',skill};
   }
   if(previous?.pointSide===opp.side&&BATTLE_COUNTER[lastHuman]&&rng()<profile.retaliate){
     return {move:moveThatBeats(lastHuman),reason:'switches after being countered',skill};
   }
   if(lastHuman&&lastHuman===prevHuman&&BATTLE_COUNTER[lastHuman]&&rng()<profile.counter){
     return {move:moveThatBeats(lastHuman),reason:'punishes a repeated vector',skill};
   }
   const preferred={Twink:'serve',Cub:'flex',Otter:'read'}[f.entry.line]||['flex','serve','read'].sort((a,b)=>attackValue(f,b==='flex'?'force':b==='serve'?'style':'insight')-attackValue(f,a==='flex'?'force':a==='serve'?'style':'insight'))[0];
   if(rng()<profile.habit)return {move:preferred,reason:`${f.entry.line.toLowerCase()} habit`,skill};
   const values=[['flex',f.stats.force],['serve',f.stats.style],['read',f.stats.insight]].sort((a,b)=>b[1]-a[1]);
   if(rng()<.52)return {move:values[0][0],reason:'strongest attack vector',skill};
   const choices=values.filter(x=>x[0]!==preferred);
   return {move:choices[Math.floor(rng()*choices.length)][0],reason:'changes the rhythm',skill};
  }

  function simulateBattle(eA,eB,balanced=true,seed=1){let m=makeBattleMatch(eA,eB,balanced,seed,true);while(!m.ended){let ma=aiBattleMove(m.a,m.b,m.rng,m),mb=aiBattleMove(m.b,m.a,m.rng,m);battleRound(m,ma,mb)}return m}

  const api = {
    /** Bind the application's live battle-state object as the engine context. */
    bindContext(next) { ctx = next || ctx; return ctx; },
    /** Current engine context (read-only intent). */
    getContext() { return ctx; },
    BATTLE_LINES,
    BATTLE_MOVES,
    BATTLE_COUNTER,
    BATTLE_SCENE_RULES,
    BATTLE_PULSE_FORECAST,
    BATTLE_OPENER_RULES,
    READ_BATTLE_POINTS,
    READ_BATTLE_MAX_EXCHANGES,
    moveThatBeats,
    sceneRule,
    resolvedBattleOpener,
    applyBattleOpener,
    battleArenaPulse,
    hashSeed,
    seededRng,
    battleStats,
    stagePassive,
    lineagePassive,
    signatureSpec,
    makeFighter,
    makeBattleMatch,
    makeReadBattleMatch,
    attackValue,
    counterMultiplier,
    battleMoveMeta,
    actionInitiative,
    applyAttack,
    battleRound,
    aiBattleMove,
    chooseCpuBattleMove,
    chooseReadRivalMove,
    simulateBattle,
  };

  root.GayDexBattleCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
