"use strict";
const $ = id => document.getElementById(id);
const CATS = [[50,"Good","#2e9e5b"],[100,"Satisfactory","#7aa62b"],[200,"Moderate","#c9a400"],[300,"Poor","#e07a1f"],[400,"Very poor","#d63b3b"],[500,"Severe","#8b1e3f"]];
function cat(v){ return CATS.find(c => v <= c[0]) || CATS[5]; }

const QUICK = {
 "Good":[["Go outside freely","Normal outdoor activity is fine. Good day to air out the home fully."],["Keep it clean","Walk, cycle or take transit to keep it that way."]],
 "Satisfactory":[["Open windows","Ventilate for 15–20 minutes at midday."],["Sensitive people","Those with asthma should keep medicines handy."]],
 "Moderate":[["Shift exercise","Move jogging and play to midday, away from busy roads."],["Ventilate midday","Air rooms when traffic is lighter, then close up."],["Cook smart","Use the exhaust fan or open a window while cooking."]],
 "Poor":[["Limit long outdoor time","Keep children’s and older adults’ outdoor time short."],["Mask for commutes","Wear a snug N95/FFP2 on busy roads."],["Run the purifier","If you have one, use it in the bedroom with doors closed."],["Skip burning","Don’t burn waste, leaves or wood. It adds to your own air."]],
 "Very poor":[["Exercise indoors","Replace outdoor workouts and sports with indoor ones."],["Keep windows shut","Close them in the morning and evening peaks."],["N95 outdoors","Any essential trip outdoors: a well-fitted N95/FFP2."],["Protect the vulnerable","Children, older adults, and people with heart or lung conditions should stay in."],["Damp-mop","Wet-wipe floors and surfaces rather than dry sweeping."]],
 "Severe":[["Stay in","Avoid all non-essential outdoor activity today."],["One clean room","Pick one room, seal gaps with towels, and use a purifier there."],["Cancel outdoor plans","School sports, walks and market trips can wait."],["Watch symptoms","Cough, wheeze, chest tightness or dizziness: call a doctor."],["Don’t add smoke","No incense, candles or burning. Use induction or LPG."]]
};

function renderQuick(){
  const v = +$("aqi").value, c = cat(v);
  $("badge").textContent = c[1]; $("badge").style.background = c[2];
  $("aqiv").textContent = v;
  $("qa").replaceChildren(...QUICK[c[1]].map(([t,d]) => {
    const el = document.createElement("div");
    const b = document.createElement("b"); b.textContent = t;
    el.append(b, document.createTextNode(d)); return el;
  }));
}
$("aqi").addEventListener("input", renderQuick);
renderQuick();

function profile(){
  const who = [...document.querySelectorAll("#who input:checked")].map(i => i.value);
  const v = +$("aqi").value;
  return `City/area: ${$("city").value || (coords ? "" : "not given (use general urban North India winter smog guidance)")}${coords ? ` (approx. coordinates ${coords.lat.toFixed(2)}, ${coords.lng.toFixed(2)}; tailor advice to this region and its typical winter smog sources)` : ""}
Current AQI: ${v} (${cat(v)[1]})
Household: ${who.length ? who.join(", ") : "healthy adults"}
Main commute: ${$("commute").value}
Cooking/heating: ${$("cook").value}
Indoor air equipment: ${$("purifier").value}
Budget: ${$("budget").value}`;
}

const INSTR = `You are an urban air quality assistant for families in cities facing severe winter smog. Using the household profile, give practical, specific advice. Use exactly these markdown sections with "## " headings: Today’s risk; Daily routine (morning, midday, evening); Indoor air hacks (low-cost first, matching the budget); Greener swaps for their commute and cooking; Why it matters (explain the direct, plain-language impact of each recommended choice on air quality and health, using qualitative claims and no invented statistics); Warning signs. Use short bullet points starting with "- ". Keep it under 450 words. Do not diagnose. Be honest that purifiers, masks and routines reduce exposure but do not eliminate it. Tailor tips to the stated fuel, commute and vulnerable members.`;

let coords = null;
function showLive(){
  const el = $("live"); if(!coords) return;
  const la = coords.lat.toFixed(4), lo = coords.lng.toFixed(4);
  el.hidden = false; el.replaceChildren();
  el.append("Live readings can’t load inside this page. Check your nearest station, then set the slider: ");
  [["Map near you","https://waqi.info/#/c/"+la+"/"+lo+"/11z"],["CPCB (India)","https://airquality.cpcb.gov.in/AQI_India/"]].forEach(([t,u],i)=>{
    if(i) el.append(" · ");
    const a = document.createElement("a"); a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = t; el.append(a);
  });
}
$("loc").addEventListener("click", () => {
  const s = $("locNote");
  if(!navigator.geolocation){ s.textContent = "Location isn’t supported here. Type your city instead."; return; }
  s.textContent = "Finding you…"; $("loc").disabled = true;
  navigator.geolocation.getCurrentPosition(p => {
    coords = {lat:p.coords.latitude, lng:p.coords.longitude};
    s.textContent = "Location detected (" + coords.lat.toFixed(2) + ", " + coords.lng.toFixed(2) + ")";
    showLive(); $("loc").disabled = false;
  }, e => {
    s.textContent = e.code === 1 ? "Location permission was declined. Type your city instead." : "Couldn’t get your location here. Type your city instead.";
    $("loc").disabled = false;
  }, {timeout:10000, maximumAge:600000});
});

let history = [], sample = null;

function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function md(t){
  const lines = esc(t).split("\n"); let html = "", inList = false;
  for (const raw of lines){
    let l = raw.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>");
    if (/^#{1,3}\s/.test(l)){ if(inList){html+="</ul>";inList=false;} html += "<h3>"+l.replace(/^#{1,3}\s/,"")+"</h3>"; }
    else if (/^\s*[-*]\s/.test(l)){ if(!inList){html+="<ul>";inList=true;} html += "<li>"+l.replace(/^\s*[-*]\s/,"")+"</li>"; }
    else if (l.trim()===""){ if(inList){html+="</ul>";inList=false;} }
    else { if(inList){html+="</ul>";inList=false;} html += "<p>"+l+"</p>"; }
  }
  if(inList) html += "</ul>";
  return html;
}

async function run(messages, target, btns){
  btns.forEach(b => b.disabled = true);
  try{
    const r = await sample(messages, {cache:false, onText: ({text}) => { target.innerHTML = md(text); }});
    target.innerHTML = md(r.text);
    history = messages.concat([{role:"assistant", content:r.text}]);
  }catch(e){
    if (e && e.code === "not_granted") target.textContent = "Permission was declined, so the AI plan is unavailable. The quick actions above still apply.";
    else if (e && e.code === "rate_limited") target.textContent = "Too many requests right now. Please wait a moment and try again.";
    else target.textContent = "Couldn’t generate a plan just now. Please try again in a bit.";
  }finally{ btns.forEach(b => b.disabled = false); }
}

$("go").addEventListener("click", async () => {
  if (!sample) return;
  $("aiCard").hidden = false;
  $("out").innerHTML = "<p class='small'>Building your plan…</p>";
  $("aiCard").scrollIntoView({behavior:"smooth", block:"start"});
  await run([{role:"user", content: INSTR + "\n\nHousehold profile:\n" + profile()}], $("out"), [$("go"), $("ask")]);
});

async function followUp(){
  const q = $("q").value.trim();
  if (!q || !sample || !history.length) return;
  $("q").value = "";
  const u = document.createElement("div"); u.className = "msg-u"; u.textContent = q;
  const a = document.createElement("div");
  $("out").append(u, a);
  await run(history.concat([{role:"user", content:q + "\n\n(Answer briefly in the same format-free style, grounded in the profile above. Not medical advice.)"}]), a, [$("go"), $("ask")]);
}
$("ask").addEventListener("click", followUp);
$("q").addEventListener("keydown", e => { if (e.key === "Enter") followUp(); });

(async () => {
  try{ sample = await window.claude.use("sample"); }catch(e){ sample = null; }
  if (!sample){ $("go").disabled = true; $("note").textContent = "AI plans aren’t available in this view. The quick actions and impact notes still work."; }
  else $("note").textContent = "Generated by Claude from your answers.";
})();
