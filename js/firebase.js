
(function(){
  const firebaseConfig = {
    apiKey: "AIzaSyBVp4pMtwgx5PEsuZQU_ftDXHGCKKHTOoY",
    authDomain: "word-adventure-tanjb.firebaseapp.com",
    projectId: "word-adventure-tanjb",
    storageBucket: "word-adventure-tanjb.firebasestorage.app",
    messagingSenderId: "535552104578",
    appId: "1:535552104578:web:5cff72047941e19e743c9b",
    measurementId: "G-NR5ETQV0CS"
  };
  const ADMIN_EMAIL = "jansencastella2@gmail.com";
  const RECENT_PROFILES_KEY = "wa-recent-google-profiles";
  let auth, db, user=null, profile=null, currentAttemptId=null, attemptStartedAt=Date.now(), lastAttemptPromise=null;
  const $=id=>document.getElementById(id);
  const status=(message,error=false)=>{const el=$("wa-profile-status");el.textContent=message||"";el.classList.toggle("error",!!error);};
  const isAdmin=()=>user&&String(user.email||"").toLowerCase()===ADMIN_EMAIL;
  const prettyMode=k=>String(k||"").replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  const escapeHtml=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const levelForXp=xp=>Math.floor(Math.max(0,Number(xp)||0)/100)+1;
  const MODE_FAVOURITE_BADGES={
    "sentence-builder":"📝 Sentence Star",
    "word-match":"🔤 Word Matcher",
    "story-blanks":"📖 Story Solver",
    "ringgit-shop":"💰 Ringgit Ranger",
    "word-detective":"🕵️ Word Detective",
    "math-word-problems":"🔢 Problem Solver",
    "fill-in-the-blank":"🧩 Blank Builder",
    "math-quiz":"🧮 Quiz Whiz"
  };
  function addModeAchievements(badges,stats){
    const attemptsByMode=Object.fromEntries(Object.keys(MODE_FAVOURITE_BADGES).map(mode=>[mode,Math.max(0,Number(stats[mode]?.attempts)||0)]));
    const playedModes=Object.values(attemptsByMode).filter(attempts=>attempts>0).length;
    if(playedModes>=3)badges.push("🧭 Game Explorer");
    if(playedModes===Object.keys(MODE_FAVOURITE_BADGES).length)badges.push("🌈 All-Round Adventurer");
    const ranked=Object.entries(attemptsByMode).sort(([,a],[,b])=>b-a),[favouriteMode,favouriteAttempts]=ranked[0];
    if(favouriteAttempts>=3&&favouriteAttempts>ranked[1][1])badges.push(MODE_FAVOURITE_BADGES[favouriteMode]);
  }
  function show(view){["wa-signin-view","wa-leaderboard-view","wa-nickname-view","wa-dashboard-view","wa-admin-view"].forEach(id=>$(id).style.display=id===view?"":"none");}
  function updateProfileButton(){const b=document.querySelector(".wa-profile-pill");if(b){b.classList.toggle("wa-logged-in",!!user);b.textContent=user?"👤 "+(profile?.displayName||user.displayName||"Student"):"👤 Student";}}
  function recentProfiles(){try{return JSON.parse(localStorage.getItem(RECENT_PROFILES_KEY)||"[]");}catch(_){return [];}}
  function rememberProfile(){if(!profile||!user)return;const items=recentProfiles().filter(p=>p.uid!==user.uid);items.unshift({uid:user.uid,displayName:profile.displayName});localStorage.setItem(RECENT_PROFILES_KEY,JSON.stringify(items.slice(0,8)));}
  function renderProfileSwitch(){const select=$("wa-profile-switch");if(!select||!profile)return;const items=recentProfiles();select.innerHTML="";items.forEach(p=>{const o=document.createElement("option");o.value=p.uid;o.textContent=p.displayName+(p.uid===user.uid?" (current)":"");select.appendChild(o);});const switchOption=document.createElement("option");switchOption.value="__switch__";switchOption.textContent="＋ Switch Google profile…";select.appendChild(switchOption);select.value=user.uid;}
  async function loadProfile(){
    if(!user)return;
    if(isAdmin()){profile=null;show("wa-admin-view");await refreshAdmin();return;}
    try{const snap=await db.collection("students").doc(user.uid).get();if(!snap.exists){profile=null;show("wa-nickname-view");return;}profile={id:user.uid,...snap.data()};rememberProfile();show("wa-dashboard-view");await refreshDashboard();}catch(e){status("Could not load your profile: "+(e.message||"try again"),true);}
  }
  async function googleSignIn(){try{const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});await auth.signInWithPopup(provider);}catch(e){status(e.message||"Google sign-in did not finish.",true);}}
  async function saveNickname(){
    const displayName=$("wa-nickname").value.normalize("NFKC").trim().replace(/\s+/g," ").slice(0,30);
    if(displayName.length<2){status("Choose a nickname with at least 2 characters.",true);return;}
    $("wa-save-nickname").disabled=true;
    try{const batch=db.batch(), studentRef=db.collection("students").doc(user.uid), leaderboardRef=db.collection("leaderboard").doc(user.uid);batch.set(studentRef,{displayName,active:true,totalXp:0,totalAttempts:0,dailyXp:0,dailyXpDate:"",gameStats:{},createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});batch.set(leaderboardRef,{displayName,totalXp:0,totalAttempts:0,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});await batch.commit();profile={id:user.uid,displayName};rememberProfile();show("wa-dashboard-view");await refreshDashboard();status("Your nickname is saved!");}catch(e){status("Could not save that nickname: "+(e.message||"try again"),true);}finally{$("wa-save-nickname").disabled=false;}
  }
  async function refreshDashboard(){
    if(!profile||!user)return;
    try{const ref=db.collection("students").doc(user.uid),snap=await ref.get();if(!snap.exists){status("Your saved profile could not be found. Progress was not changed.",true);return;}const d=snap.data(),xp=Number(d.totalXp);if(!Number.isFinite(xp)||xp<0){status("Your saved XP is invalid. Progress was not changed.",true);return;}const stats=d.gameStats||{};profile={id:user.uid,...d,totalXp:xp};
      $("wa-welcome-name").textContent="Welcome back, "+d.displayName+"!";$("wa-level").textContent=String(levelForXp(xp));$("wa-xp").textContent=String(xp);$("wa-attempts").textContent=String(d.totalAttempts||0);
      const badges=[];if((d.totalAttempts||0)>=1)badges.push("🌱 First Steps");if((d.totalAttempts||0)>=10)badges.push("🎯 10 Attempts");if(xp>=100)badges.push("⭐ 100 XP");if(xp>=500)badges.push("💎 500 XP");addModeAchievements(badges,stats);
      $("wa-badges").innerHTML=badges.length?badges.map(b=>'<span class="wa-badge">'+escapeHtml(b)+"</span>").join(""):'<span class="wa-muted">Play a game to earn your first achievement.</span>';
      $("wa-game-stats").innerHTML=Object.entries(stats).length?Object.entries(stats).map(([k,v])=>'<div class="wa-attempt-row"><span>'+escapeHtml(prettyMode(k))+'</span><span><b>'+(v.attempts||0)+"</b> plays · best "+(v.bestScore||0)+"</span></div>").join(""):'<p class="wa-muted">No games completed yet.</p>';
      const attempts=await ref.collection("attempts").orderBy("completedAt","desc").limit(10).get();$("wa-recent-attempts").innerHTML=attempts.empty?'<p class="wa-muted">Your completed games will appear here.</p>':attempts.docs.map(doc=>{const a=doc.data(),date=a.completedAt?.toDate?a.completedAt.toDate().toLocaleDateString():"";return '<div class="wa-attempt-row"><span>'+escapeHtml(prettyMode(a.gameMode))+'<br><span class="wa-muted">'+date+"</span></span><span><b>"+a.score+"/"+a.maxScore+'</b><br><span class="wa-muted">+'+(a.xpAwarded||0)+" XP</span></span></div>";}).join("");
      updateProfileButton();renderProfileSwitch();await refreshLeaderboard();
    }catch(e){status("Could not load progress: "+(e.message||"try again"),true);}
  }
  async function refreshLeaderboard(){try{const snap=await db.collection("leaderboard").get(),players=snap.docs.map(doc=>{const d=doc.data(),totalXp=Math.max(0,Number(d.totalXp)||0);return {displayName:d.displayName||"Player",totalXp,level:levelForXp(totalXp)};}).sort((a,b)=>b.level-a.level||b.totalXp-a.totalXp||a.displayName.localeCompare(b.displayName)).slice(0,10),box=$("wa-leaderboard"),full=$("wa-leaderboard-full");const markup=players.length?players.map((player,i)=>'<div class="wa-leaderboard-row"><span class="wa-leaderboard-rank">'+(i+1)+'</span><span class="wa-leaderboard-name">'+escapeHtml(player.displayName)+'</span><span>Level '+player.level+" · "+player.totalXp+' XP</span></div>').join(""):'<p class="wa-muted">Be the first to play!</p>';if(box)box.innerHTML=markup;if(full)full.innerHTML=markup;}catch(e){const fallback='<p class="wa-muted">Leaderboard is unavailable right now.</p>';const box=$("wa-leaderboard"),full=$("wa-leaderboard-full");if(box)box.innerHTML=fallback;if(full)full.innerHTML=fallback;}}
  async function refreshAdmin(){if(!isAdmin())return;try{const snap=await db.collection("students").orderBy("displayName").limit(500).get();const box=$("wa-admin-profiles");box.innerHTML=snap.empty?'<p class="wa-muted">No student profiles yet.</p>':snap.docs.map(doc=>{const s=doc.data();return '<div class="wa-admin-row"><span><b>'+escapeHtml(s.displayName)+"</b><br><small>"+(s.totalAttempts||0)+" plays · "+(s.totalXp||0)+' XP</small></span><span><button type="button" data-rename="'+doc.id+'">Rename</button><button type="button" data-delete="'+doc.id+'">Remove</button></span></div>';}).join("");}catch(e){status("Could not load profiles: "+(e.message||"try again"),true);}}
  async function adminRename(id){const displayName=prompt("New nickname:");if(displayName===null)return;const name=displayName.normalize("NFKC").trim().replace(/\s+/g," ").slice(0,30);if(name.length<2){status("Nickname must have at least 2 characters.",true);return;}try{await db.collection("students").doc(id).update({displayName:name,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});await refreshAdmin();}catch(e){status(e.message||"Could not rename profile.",true);}}
  async function adminRemove(id){if(!confirm("Remove this Google account's game profile and saved results? This blocks that account from creating a new profile."))return;try{const ref=db.collection("students").doc(id),attempts=await ref.collection("attempts").get(),batch=db.batch();attempts.docs.forEach(doc=>batch.delete(doc.ref));batch.delete(ref);batch.delete(db.collection("leaderboard").doc(id));batch.set(db.collection("blockedStudents").doc(id),{blockedAt:firebase.firestore.FieldValue.serverTimestamp(),blockedBy:user.uid});await batch.commit();status("Profile removed.");await refreshAdmin();}catch(e){status(e.message||"Could not remove profile.",true);}}
  function logout(){auth.signOut();}
  function uuid(){return crypto.randomUUID?crypto.randomUUID().replace(/-/g,""):(Date.now().toString(36)+Math.random().toString(36).slice(2)).slice(0,32);}
  async function recordAttempt(data){
    if(!profile)return {saved:false,reason:"not-logged-in"};if(lastAttemptPromise)return lastAttemptPromise;const attemptId=currentAttemptId||(currentAttemptId=uuid()),maxScore=Number.isFinite(data.maxScore)&&data.maxScore>0?data.maxScore:100,score=Math.max(0,Math.min(maxScore,Number(data.score)||0)),ref=db.collection("students").doc(user.uid),attemptRef=ref.collection("attempts").doc(attemptId),utcDate=new Date().toISOString().slice(0,10),safe=n=>Number.isInteger(n)&&n>=0?Math.min(n,10000):0;
    lastAttemptPromise=db.runTransaction(async tx=>{const [student,existing]=await Promise.all([tx.get(ref),tx.get(attemptRef)]);if(!student.exists)throw new Error("Profile not found.");if(existing.exists)return {duplicate:true,xpAwarded:existing.get("xpAwarded")||0};const d=student.data(),daily=d.dailyXpDate===utcDate?(d.dailyXp||0):0,xp=Math.max(0,Math.min(50,Math.max(5,Math.round(score/maxScore*50)))),dailyAwarded=Math.min(xp,Math.max(0,100-daily)),stats=d.gameStats||{},old=stats[data.gameMode]||{},result={attemptId,gameMode:data.gameMode||"other",score,maxScore,correct:safe(data.correct),incorrect:safe(data.incorrect),hintsUsed:safe(data.hintsUsed),durationSeconds:Math.max(0,Math.round((Date.now()-attemptStartedAt)/1000)),xpAwarded:xp,completedAt:firebase.firestore.FieldValue.serverTimestamp()};tx.set(attemptRef,result);tx.update(ref,{totalAttempts:(d.totalAttempts||0)+1,totalXp:(d.totalXp||0)+xp,dailyXpDate:utcDate,dailyXp:daily+dailyAwarded,gameStats:{...stats,[result.gameMode]:{attempts:(old.attempts||0)+1,bestScore:Math.max(old.bestScore||0,score),lastScore:score,lastPlayedAt:firebase.firestore.FieldValue.serverTimestamp()}},updatedAt:firebase.firestore.FieldValue.serverTimestamp()});tx.set(db.collection("leaderboard").doc(user.uid),{displayName:d.displayName||profile.displayName,totalXp:(d.totalXp||0)+xp,totalAttempts:(d.totalAttempts||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});return {duplicate:false,xpAwarded:xp};}).then(async r=>{status(r.duplicate?"This result was already saved.":"Progress saved to your profile.");await refreshDashboard();return {saved:true,...r};}).catch(e=>{status("Your result could not be saved: "+(e.message||"try again"),true);return {saved:false,error:e.message};}).finally(()=>lastAttemptPromise=null);return lastAttemptPromise;
  }
  window.WAStudent={beginAttempt(){currentAttemptId=uuid();attemptStartedAt=Date.now();lastAttemptPromise=null;},recordAttempt};
  window.openStudentPanel=async()=>{$("wa-profile-modal").classList.add("open");if(user)await loadProfile();else show("wa-signin-view");};
  window.openLeaderboardPanel=async()=>{$("wa-profile-modal").classList.add("open");show("wa-leaderboard-view");await refreshLeaderboard();};
  window.closeStudentPanel=()=>$("wa-profile-modal").classList.remove("open");
  $("wa-leaderboard-back").addEventListener("click",()=>{if(user)loadProfile();else show("wa-signin-view");});$("wa-google-signin").addEventListener("click",googleSignIn);$("wa-profile-switch").addEventListener("change",e=>{if(e.target.value!==user.uid){e.target.value=user.uid;auth.signOut().then(googleSignIn);}});$("wa-save-nickname").addEventListener("click",saveNickname);$("wa-google-logout-setup").addEventListener("click",logout);$("wa-google-logout").addEventListener("click",logout);$("wa-refresh-dashboard").addEventListener("click",async()=>{if(!window.confirm("Refresh your saved progress from the cloud? This will not reset your XP, level, or attempts."))return;status("Refreshing saved progress…");await refreshDashboard();});$("wa-admin-refresh").addEventListener("click",refreshAdmin);$("wa-admin-logout").addEventListener("click",logout);$("wa-admin-profiles").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.rename)adminRename(b.dataset.rename);if(b.dataset.delete)adminRemove(b.dataset.delete);});
  try{firebase.initializeApp(firebaseConfig);auth=firebase.auth();db=firebase.firestore();auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});auth.onAuthStateChanged(async next=>{user=next;profile=null;updateProfileButton();if(!user){show("wa-signin-view");return;}await loadProfile();});}catch(e){status("Firebase could not initialise: "+(e.message||"check configuration"),true);}
})();
