'use strict';
const SUPABASE_URL=window.SUPABASE_URL||'';
const SUPABASE_ANON_KEY=window.SUPABASE_ANON_KEY||'';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const API={getLeads:'https://n8n.upleaddigital.com/webhook/get-leads',getClients:'https://n8n.upleaddigital.com/webhook/get-clients',leadManagement:'https://n8n.upleaddigital.com/webhook/lead-management',getRecordings:'https://n8n.upleaddigital.com/webhook/get-recordings',

  getActivities:'https://n8n.upleaddigital.com/webhook/get-lead-activities',
  sendEmail:'https://n8n.upleaddigital.com/webhook/upclose-send-email',
  sendSms:'https://n8n.upleaddigital.com/webhook/upclose-send-sms',
  logCall:'https://n8n.upleaddigital.com/webhook/upclose-start-call',

  adSpend:'https://n8n.upleaddigital.com/webhook/ad-spend',
  createTeamMember:'https://n8n.upleaddigital.com/webhook/create-team-member',

  // Reputation / Reviews — integration point. This endpoint does not exist yet.
  // When it is built server-side, it must resolve the review_url from
  // lead_id -> client_id -> client review configuration. It must NEVER
  // trust a review_url supplied by the frontend. See ReviewRequestService.
  sendReviewRequest:'https://n8n.upleaddigital.com/webhook/send-review-request',

  getVoiceToken:'https://upclose-voice-3210.twil.io/voice-token'
};
 
const N8N_API_KEY='REPLACE_WITH_YOUR_N8N_SHARED_SECRET';
const PAGE_TITLES={dashboard:'Dashboard',opportunities:'Leads',pipeline:'Pipeline',clients:'Clients',communication:'Communication Hub',reviews:'Reviews',activity:'Activity',meetings:'Meetings Hub',analytics:'Analytics',funnel:'Funnel Metrics',reports:'Reports',automations:'Automations',settings:'Settings'};
const VALID_PAGES=Object.keys(PAGE_TITLES);
let allLeads=[],allClients=[],currentLead=null,activeFilter='all',calYear=new Date().getFullYear(),calMonth=new Date().getMonth(),confirmCallback=null,activityLoaded=false,clientsLoaded=false,currentUser=null,currentProfile=null,pipelineDragId=null,closersMap={},closersLoaded=false;
let recProviders={fathom:{connected:false,label:'Fathom AI'},googleMeet:{connected:false,label:'Google Meet Recordings'}};
let allRecordings=[],recPreviewMode=false,recProviderFilter='all';

async function bootAuth(){
  try{
    const{data:{session},error}=await sb.auth.getSession();
    if(error||!session){redirectToLogin();return;}
    currentUser=session.user;
    await loadUserProfile(currentUser);renderUserUI();showApp();
    sb.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){redirectToLogin();return;}
      if(event==='INITIAL_SESSION')return;
      if(event==='TOKEN_REFRESHED'&&session){currentUser=session.user;return;}
      if(event==='USER_UPDATED'&&session){currentUser=session.user;loadUserProfile(currentUser).then(renderUserUI);return;}
      if(!session&&event!=='PASSWORD_RECOVERY')redirectToLogin();
    });
    bootPage();await loadLeads();await preloadClientsCount();
  }catch(e){console.error('Auth boot failed:',e);redirectToLogin();}
}
async function loadUserProfile(user){
  try{
    const{data,error}=await sb.from('profiles').select('id,email,full_name,role,created_at').eq('id',user.id).single();
    if(error){currentProfile={id:user.id,email:user.email,full_name:user.user_metadata?.full_name||user.email?.split('@')[0]||'User',role:user.user_metadata?.role||'Agent'};}
    else{currentProfile=data;}
  }catch(e){currentProfile={id:user.id,email:user.email,full_name:user.email?.split('@')[0]||'User',role:'Agent'};}
}
function renderUserUI(){
  if(!currentProfile)return;
  const name=currentProfile.full_name||currentProfile.email||'User',role=currentProfile.role||'Agent';
  const initls=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  setEl('userDisplayName',name);setEl('userRoleLabel',role);setEl('userAvatar',initls);setEl('userMenuEmail',currentProfile.email||'—');
  setEl('settingsName',name);setEl('settingsEmail',currentProfile.email||'—');setEl('settingsRole',role);setEl('settingsAvatar',initls);
}
function setEl(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function showApp(){const loader=document.getElementById('authLoader');loader.classList.add('fade');setTimeout(()=>{loader.style.display='none';document.getElementById('app').classList.add('ready');},320);}
function redirectToLogin(){window.location.replace('index.html');}
async function handleSignOut(){closeUserMenu();try{await sb.auth.signOut();}catch(e){console.error('SignOut error:',e);}redirectToLogin();}
function toggleUserMenu(){document.getElementById('userMenu').classList.toggle('open');}
function closeUserMenu(){document.getElementById('userMenu').classList.remove('open');}
document.addEventListener('click',e=>{const wrap=document.querySelector('.user-menu-wrap');if(wrap&&!wrap.contains(e.target))closeUserMenu();});

function navigate(p,pushState=true){
  if(!VALID_PAGES.includes(p))p='dashboard';
  if(p==='calendar'){p='meetings';if(pushState&&location.hash!=='#meetings')history.pushState({page:'meetings'},'','#meetings');}
  if(pushState&&location.hash!=='#'+p)history.pushState({page:p},'','#'+p);
  document.querySelectorAll('.pv').forEach(x=>x.classList.remove('active'));
  const pv=document.getElementById('pv-'+p);if(pv)pv.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const nav=document.querySelector(`.nav-item[data-page="${p}"]`);if(nav)nav.classList.add('active');
  document.getElementById('ptitle').textContent=PAGE_TITLES[p]||p;
  closeCmdPal();closeUserMenu();closeMobileSidebar();
  if(p==='clients'){
    const pvC=document.getElementById('pv-clients');
    
    if(!clientsLoaded){loadClients();clientsLoaded=true;}
  }
  if(p==='activity'&&!activityLoaded){loadActivity();activityLoaded=true;}
  if(p==='meetings')renderMeetingsHub();
  if(p==='pipeline')renderPipeline();
  if(p==='analytics')renderAnalytics();
  if(p==='funnel')renderFunnelDashboard();
  if(p==='reports')renderReports();
  if(p==='communication')renderCommunicationHub();
  if(p==='automations')autoShowList();
  if(p==='reviews'){
    if(!clientsLoaded){clientsLoaded=true;loadClients().then(renderReviewsPage);}
    else renderReviewsPage();
  }
}
window.addEventListener('popstate',e=>{navigate((e.state&&e.state.page)||pageFromHash(),false);});
function pageFromHash(){const h=location.hash.replace('#','');if(h==='calendar')return'meetings';return VALID_PAGES.includes(h)?h:'dashboard';}
function bootPage(){const p=pageFromHash();navigate(p,false);history.replaceState({page:p},'','#'+p);}
function page(){return location.hash.replace('#','')||'dashboard';}

  document.getElementById('sidebarToggle').addEventListener('click', () => {
  if (window.innerWidth <= 768) return;

  const s = document.getElementById('sidebar');
  const collapsed = s.style.width === '56px';

  s.style.width = collapsed ? '220px' : '56px';
  s.style.minWidth = collapsed ? '220px' : '56px';

  s.querySelectorAll('.lbl,.nbadge,.nav-logo-text').forEach(el => {
    el.style.display = collapsed ? '' : 'none';
  });

  const alert = document.getElementById('sidebarAlert');
  if (alert) {
    alert.style.display = collapsed ? '' : 'none';
  }

  const user = document.getElementById('userTrigger');
  if (user) {
    user.style.display = 'flex';

    if (collapsed) {
      user.style.justifyContent = '';
      user.style.padding = '';

      user.querySelectorAll('.lbl,.user-name,.user-role').forEach(el => {
        el.style.display = '';
      });

      const role = document.getElementById('userRoleLabel');
      if (role) role.style.display = '';

    } else {
      user.style.justifyContent = 'center';
      user.style.padding = '8px';

      user.querySelectorAll('.lbl,.user-name,.user-role').forEach(el => {
        el.style.display = 'none';
      });

      const role = document.getElementById('userRoleLabel');
      if (role) role.style.display = 'none';
    }
  }
});
  

function closeMobileSidebar(){document.getElementById('sidebar').classList.remove('mobile-open');document.getElementById('mobileSidebarOverlay').classList.remove('show');}
document.getElementById('sidebarToggle').addEventListener('click',()=>{
  if(window.innerWidth>768)return;
  const sidebar=document.getElementById('sidebar');
  const isOpen=sidebar.classList.contains('mobile-open');
  if(isOpen){closeMobileSidebar();}else{sidebar.classList.add('mobile-open');document.getElementById('mobileSidebarOverlay').classList.add('show');}
});

function fmtDate(d){if(!d)return'—';const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d).trim());const dt=m?new Date(Number(m[1]),Number(m[2])-1,Number(m[3])):new Date(d);if(isNaN(dt.getTime()))return String(d);return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});}
function fmtTime(t){if(!t)return'—';const m=/^(\d{1,2}):(\d{2})$/.exec(String(t).trim());if(!m)return t;let h=parseInt(m[1],10);const min=m[2];const period=h>=12?'PM':'AM';let h12=h%12;if(h12===0)h12=12;return h12+':'+min+' '+period;}
function scClass(status){return{Won:'gr',Lost:'re',Potential:'bl'}[status]||'gy';}
function initials(s){if(!s)return'?';return s.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);}
function toast(msg,type='ok'){const el=document.getElementById('lpToast');el.textContent=msg;el.className=`lp-toast ${type} show`;setTimeout(()=>{el.className='lp-toast';},3000);}
function showConfirm(title,msg,okLabel,okClass,cb){
  document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmMsg').textContent=msg;
  const btn=document.getElementById('confirmOkBtn');btn.textContent=okLabel;btn.className=`abtn ${okClass}`;
  confirmCallback=cb;document.getElementById('confirmDialog').classList.add('open');
}
function confirmCancel(){document.getElementById('confirmDialog').classList.remove('open');confirmCallback=null;}
function confirmOk(){document.getElementById('confirmDialog').classList.remove('open');if(typeof confirmCallback==='function')confirmCallback();confirmCallback=null;}
function openCmdPal(){document.getElementById('cmdpal').classList.add('open');setTimeout(()=>document.getElementById('cmdinput').focus(),50);}
function closeCmdPal(){document.getElementById('cmdpal').classList.remove('open');}
function setPeriod(period,el){document.querySelectorAll('#periodToggle .period-btn').forEach(b=>b.classList.remove('active'));el.classList.add('active');}

window.addEventListener('mousemove',e=>{
  const bar=document.getElementById('floatBar');
  if(window.innerHeight-e.clientY<120){bar.classList.add('visible');}else{bar.classList.remove('visible');}
});

async function loadLeads(){
  renderTableLoading();
  try{
    const res=await fetch(API.getLeads);const data=await res.json();
    allLeads=Array.isArray(data)?data:[];
    renderTable(allLeads);updateSidebarCounts();updateDashboard();
    if(page()==='pipeline')renderPipeline();
    if(page()==='meetings')renderMeetingsHub();
    if(page()==='analytics')renderAnalytics();
    if(page()==='reports')renderReports();
    if(page()==='communication')renderCommunicationHub();
    updateMeetingsBadge();
  }catch(e){document.getElementById('leadsTable').innerHTML=`<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--re)"><span class="mat sm">error</span> No Leads</td></tr>`;}
}
function renderTableLoading(){document.getElementById('leadsTable').innerHTML=`<tr class="loading-row"><td colspan="9"><span class="spin mat sm">sync</span> Loading leads…</td></tr>`;}
function renderTable(leads){
  const tbody=document.getElementById('leadsTable');
  const count=document.getElementById('leadsCount');
if(!leads.length){
  tbody.innerHTML=`
    <tr>
      <td colspan="9">
        <div class="empty-state">
          <span class="mat">person_search</span>
          <p>No leads found.</p>
        </div>
      </td>
    </tr>`;
  return;
}
  tbody.innerHTML=leads.map(lead=>{
    const name=((lead.first_name||'')+' '+(lead.last_name||'')).trim()||'—';
    const date=lead.preferred_date?`${fmtDate(lead.preferred_date)}${lead.preferred_time?' '+fmtTime(lead.preferred_time):''}`:'—';
    const last=lead.last_contacted_at?fmtDate(lead.last_contacted_at):'<span style="color:var(--tx3)">Never</span>';
    const init=initials(lead.company_name||name);
    return `<tr onclick="openLead(${lead.id})" style="cursor:pointer">
      <td onclick="event.stopPropagation()"><input type="checkbox" style="accent-color:var(--acc)"></td>
      <td><div style="display:flex;align-items:center;gap:8px"><div style="width:26px;height:26px;border-radius:5px;background:rgba(124,58,237,0.15);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--acc);flex-shrink:0">${init}</div><div><div style="font-weight:600">${lead.company_name||'—'}</div><div style="font-size:12px;color:var(--tx3)">${lead.utm_source||'—'}</div></div></div></td>
      <td><div>${name}</div><div style="font-size:12px;color:var(--tx3)">${lead.email||''}</div></td>
      <td><span class="badge st-${lead.status||'Potential'}">${lead.status||'Potential'}</span></td>
      <td style="color:var(--tx2)">${lead.phone||'—'}</td>
      <td>${lead.utm_campaign?`<span class="badge ac" style="font-size:11px">${lead.utm_campaign}</span>`:'<span style="color:var(--tx3)">—</span>'}</td>
      <td style="color:var(--tx2);font-size:13px">${date}</td>
      <td style="font-size:13px">${last}</td>
      <td onclick="event.stopPropagation()"><button class="tbb" style="width:28px;height:28px" onclick="openLead(${lead.id})"><span class="mat sm">open_in_new</span></button></td>
    </tr>`;
  }).join('');
}
function filterLeads(filter,el){
  activeFilter=filter;
  document.querySelectorAll('#leadsFilterGroup .topt').forEach(t=>t.classList.remove('active'));
  if(el)el.classList.add('active');
  renderTable(filter==='all'?allLeads:allLeads.filter(l=>l.status===filter));
}
function updateSidebarCounts(){
  const potential=allLeads.filter(l=>l.status==='Potential').length;
  const el=document.getElementById('navCountLeads');if(el)el.textContent=potential;
  const neverContacted=allLeads.filter(l=>!l.last_contacted_at&&l.status==='Potential').length;
  const alertBox=document.getElementById('sidebarAlert');
  if(neverContacted>0&&alertBox){alertBox.style.display='';document.getElementById('sidebarAlertTitle').textContent=`${neverContacted} untouched lead${neverContacted!==1?'s':''}`;document.getElementById('sidebarAlertBody').textContent=`${neverContacted} potential lead${neverContacted!==1?'s':''} never contacted`;}
  else if(alertBox){alertBox.style.display='none';}
}
function updateDashboard(){
  const total=allLeads.length,potential=allLeads.filter(l=>l.status==='Potential').length,won=allLeads.filter(l=>l.status==='Won').length,lost=allLeads.filter(l=>l.status==='Lost').length;
  setEl('statTotal',total);setEl('statPotential',potential);setEl('statWon',won);setEl('statLost',lost);
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const weekEnd=new Date(now);weekEnd.setDate(now.getDate()+6);const weekStr=weekEnd.toISOString().slice(0,10);
  const mt=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr).length;
  const mw=allLeads.filter(l=>{if(!l.preferred_date)return false;const d=l.preferred_date.slice(0,10);return d>=todayStr&&d<=weekStr;}).length;
  setEl('dashMeetingsToday',mt);setEl('dashMeetingsWeek',mw);
  const winPct=(won+lost)>0?((won/(won+lost))*100).toFixed(0):null;
  const twl=document.getElementById('trendWonLabel');if(twl)twl.textContent=winPct!==null?`${winPct}% win rate`:'converted';

  const bkEl=document.getElementById('dashBreakdown');
  if(bkEl&&total>0){
    bkEl.innerHTML=`
      <div class="src-row"><div class="src-row-hd"><span class="src-row-name">Potential</span><span class="src-row-pct">${potential}</span></div><div class="src-bar-track"><div class="src-bar-fill" style="width:${(potential/total*100).toFixed(0)}%;background:var(--bl)"></div></div></div>
      <div class="src-row"><div class="src-row-hd"><span class="src-row-name">Won</span><span class="src-row-pct">${won}</span></div><div class="src-bar-track"><div class="src-bar-fill" style="width:${(won/total*100).toFixed(0)}%;background:var(--gr)"></div></div></div>
      <div class="src-row"><div class="src-row-hd"><span class="src-row-name">Lost</span><span class="src-row-pct">${lost}</span></div><div class="src-bar-track"><div class="src-bar-fill" style="width:${(lost/total*100).toFixed(0)}%;background:var(--re)"></div></div></div>`;
  }else if(bkEl){bkEl.innerHTML=`<div style="text-align:center;padding:12px;color:var(--tx3);font-size:13px">No leads yet</div>`;}

  const latest=[...allLeads].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,6);
  const latestEl=document.getElementById('dashLatestLeads');
  if(latestEl){
    latestEl.innerHTML=latest.length?latest.map(l=>{
      const nm=((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';
      return `<tr onclick="openLead(${l.id})" style="cursor:pointer">
        <td><div style="display:flex;align-items:center;gap:8px"><div style="width:26px;height:26px;border-radius:5px;background:rgba(124,58,237,0.15);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--acc)">${initials(nm)}</div><span style="font-size:14px;font-weight:500">${nm}</span></div></td>
        <td style="font-size:13px;color:var(--bl)">${l.company_name||'—'}</td>
        <td><span class="badge st-${l.status||'Potential'}">${l.status||'Potential'}</span></td>
        <td style="font-size:12px;color:var(--tx3)">${fmtDate(l.created_at)}</td>
        <td style="text-align:right"><span class="mat sm" style="color:var(--tx3);font-size:15px">arrow_forward_ios</span></td>
      </tr>`;
    }).join(''):`<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--tx3)">No leads yet</td></tr>`;
  }

  const upcoming=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)>=todayStr).sort((a,b)=>a.preferred_date.localeCompare(b.preferred_date)).slice(0,4);
  const upEl=document.getElementById('dashUpcomingMeetings');
  if(upEl){
    upEl.innerHTML=upcoming.length?upcoming.map(l=>{
      const isToday=l.preferred_date.slice(0,10)===todayStr;
      const nm=((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';
      return `<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(74,68,85,0.3);transition:background .12s" onmouseover="this.style.background='rgba(255,255,255,0.04)'" onmouseout="this.style.background=''" onclick="openLead(${l.id})">
        <div style="font-size:11px;font-weight:700;color:${isToday?'var(--pri-c)':'var(--tx3)'};margin-bottom:3px">${fmtDate(l.preferred_date)}${l.preferred_time?' — '+fmtTime(l.preferred_time):''}</div>
        <div style="font-size:14px;font-weight:600;color:var(--tx)">${l.company_name||'—'}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px"><div style="width:16px;height:16px;border-radius:50%;background:var(--acc-d);display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;color:var(--acc)">${initials(nm)}</div><span style="font-size:12px;color:var(--tx3)">${nm}</span></div>
      </div>`;
    }).join(''):`<div style="text-align:center;padding:24px;color:var(--tx3);font-size:13px"><span class="mat" style="font-size:25px;display:block;margin-bottom:8px;opacity:0.4">event_busy</span>No upcoming meetings</div>`;
  }

  const decided=won+lost,wr=decided>0?Math.round((won/decided)*100):null;
  const wrEl=document.getElementById('statWinRate');if(wrEl){wrEl.textContent=wr!==null?wr+'%':'—';wrEl.className='kpi-val-lg '+(wr===null?'kpi-muted':wr>=50?'kpi-good':'kpi-warn');}
  const neverCont=allLeads.filter(l=>!l.last_contacted_at&&l.status==='Potential').length;
  const ncEl=document.getElementById('statNeverContacted');if(ncEl){ncEl.textContent=neverCont||'—';ncEl.className='kpi-val-lg '+(neverCont>0?'kpi-warn':'kpi-good');}
  const ncSubEl=document.getElementById('statNeverContactedSub');if(ncSubEl){const pct=potential>0?Math.round((neverCont/potential)*100):0;ncSubEl.textContent=neverCont>0?`${pct}% of potential pipeline`:'all potential leads contacted';}
  const velEl=document.getElementById('statVelocity');if(velEl){const cl=allLeads.filter(l=>l.status==='Won'&&l.converted_at&&l.created_at);if(cl.length){const avgMs=cl.reduce((s,l)=>s+Math.max(0,new Date(l.converted_at)-new Date(l.created_at)),0)/cl.length;velEl.textContent=Math.round(avgMs/86400000)+'d';velEl.className='kpi-val-lg kpi-good';}else{velEl.textContent='—';velEl.className='kpi-val-lg kpi-muted';}}
  updateSourceEfficiency();updatePipelineHealth(total,potential,won,lost,neverCont);updateFollowupAlerts(neverCont,potential);updateVelocityChart();
}
function updateSourceEfficiency(){
  const el=document.getElementById('dashSourceEfficiency');if(!el)return;
  const sources={};
  allLeads.forEach(l=>{const src=l.utm_source||'Direct';if(!sources[src])sources[src]={total:0,won:0};sources[src].total++;if(l.status==='Won')sources[src].won++;});
  const entries=Object.entries(sources).sort((a,b)=>b[1].total-a[1].total).slice(0,5);
  if(!entries.length){el.innerHTML=`<div style="font-size:12px;color:var(--tx3);text-align:center;padding:8px">No source data yet</div>`;return;}
  const maxTotal=entries[0][1].total;
  const colors=['var(--acc)','var(--bl)','var(--am)','var(--gr)','var(--pu)'];
  el.innerHTML=entries.map(([src,data],i)=>{const pct=Math.round((data.total/maxTotal)*100);return `<div class="src-row"><div class="src-row-hd"><span class="src-row-name">${src}</span><span class="src-row-pct">${pct}%</span></div><div class="src-bar-track"><div class="src-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div></div>`;}).join('');
}
function updatePipelineHealth(total,potential,won,lost,neverCont){
  const hb=document.getElementById('healthBar'),hl=document.getElementById('healthLabel'),hd=document.getElementById('healthDesc');if(!hb)return;
  if(total===0){hb.style.width='0%';if(hl)hl.textContent='NO DATA';if(hd)hd.textContent='Add leads to track pipeline health.';return;}
  const wr=(won+lost)>0?won/(won+lost):0.5,cr=total>0?1-(neverCont/total):1,score=Math.round((wr*0.5+cr*0.5)*100);
  hb.style.width=score+'%';hb.style.background=score>=70?'var(--gr)':score>=40?'var(--am)':'var(--re)';
  if(hl){hl.textContent=score>=70?'GOOD':score>=40?'FAIR':'POOR';hl.style.color=score>=70?'var(--gr)':score>=40?'var(--am)':'var(--re)';}
  if(hd)hd.textContent=`${score}% score · ${neverCont} leads need contact · ${potential} active opportunities`;
}
function updateFollowupAlerts(neverCont,potential){
  const el=document.getElementById('dashAlerts');if(!el)return;
  const alerts=[];
  if(neverCont>0)alerts.push({type:'err',title:`${neverCont} Untouched Lead${neverCont!==1?'s':''}`,time:'Action needed',body:`${neverCont} potential lead${neverCont!==1?'s':''} have never been contacted.`,action:'View Leads',onclick:`navigate('opportunities')`});
  const overdue=allLeads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<new Date()&&l.status==='Potential');
  if(overdue.length>0)alerts.push({type:'err',title:`${overdue.length} Overdue Follow-up${overdue.length!==1?'s':''}`,time:`${overdue.length} overdue`,body:`${overdue[0].company_name||'A lead'} has a past-due follow-up date.`,action:'View Lead',onclick:`openLead(${overdue[0].id})`});
  const recent=allLeads.filter(l=>{if(!l.created_at)return false;const hrs=(Date.now()-new Date(l.created_at))/3600000;return hrs<24&&l.status==='Potential';});
  if(recent.length>0)alerts.push({type:'info',title:`${recent.length} New Lead${recent.length!==1?'s':''} Today`,time:'Just now',body:`${recent[0].company_name||'A new lead'} was added in the last 24 hours.`,action:'View Lead',onclick:`openLead(${recent[0].id})`});
  if(!alerts.length){el.innerHTML=`<div style="text-align:center;padding:14px;font-size:13px;color:var(--tx3)"><span class="mat sm" style="display:block;margin-bottom:6px;font-size:23px;opacity:0.4">check_circle</span>No alerts — pipeline looks healthy</div>`;return;}
  el.innerHTML=alerts.map(a=>`<div class="followup-alert ${a.type}"><div style="display:flex;justify-content:space-between;align-items:flex-start"><span class="followup-alert-title">${a.title}</span><span class="followup-alert-time" style="color:${a.type==='err'?'var(--re)':'var(--acc)'}">${a.time}</span></div><div class="followup-alert-body">${a.body}</div><button onclick="${a.onclick}" style="margin-top:6px;font-size:11px;font-weight:700;color:${a.type==='err'?'var(--re)':'var(--acc)'};background:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:0;text-transform:uppercase;letter-spacing:0.04em">${a.action} →</button></div>`).join('');
}
function updateVelocityChart(){
  const chart=document.getElementById('velocityChart');if(!chart)return;
  const weeks=[0,0,0,0,0,0],now=Date.now();
  allLeads.forEach(l=>{if(!l.created_at)return;const wa=Math.floor((now-new Date(l.created_at))/604800000);if(wa>=0&&wa<6)weeks[5-wa]++;});
  const max=Math.max(...weeks,1);
  chart.innerHTML=weeks.map((v,i)=>{const h=Math.max(8,Math.round((v/max)*90));return `<div class="vel-bar${i===5?' current':''}" style="height:${h}%" title="WK${i+1}: ${v} leads"></div>`;}).join('');
}
async function preloadClientsCount(){
  try{
    const res=await fetch(API.getClients);const data=await res.json();
    allClients=Array.isArray(data)?data:[];
    const el=document.getElementById('navCountClients');if(el)el.textContent=allClients.length;
    const dEl=document.getElementById('statClients');if(dEl)dEl.textContent=allClients.length;
    if(page()==='clients'){
      renderClientsKpis(allClients);
      renderClientsTable(getFilteredClients());
      clientsLoaded=true;
    }
  }catch(e){console.warn('Could not preload clients:',e);}
}

let currentClient=null,clientsFilterMode='all',clientsSearchQuery='',clientsAdvFilters={manager:'',source:'',dateFrom:'',dateTo:''};

function renderClientsKpis(clients){
  const total=clients.length;
  const won=clients.filter(c=>(c.status||c.lead_status||'')==='Won').length;
  const active=clients.filter(c=>(c.status||c.lead_status||'')==='Potential').length;
  const sorted=[...clients].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const newest=sorted.length?(sorted[0].company_name||((sorted[0].first_name||'')+' '+(sorted[0].last_name||'')).trim()||'—'):'—';
  const g=id=>{const e=document.getElementById(id);return e;};
  if(g('ckpi-total'))g('ckpi-total').textContent=total;
  if(g('ckpi-active'))g('ckpi-active').textContent=active;
  if(g('ckpi-won'))g('ckpi-won').textContent=won;
  if(g('ckpi-newest'))g('ckpi-newest').textContent=newest;
}

async function loadClients(){
  const tbody=document.getElementById('clientsTable');
  if(tbody)tbody.innerHTML='<tr class="loading-row"><td colspan="10"><span class="spin mat sm">sync</span> Loading clients…</td></tr>';
  try{
    const res=await fetch(API.getClients);const data=await res.json();
    allClients=Array.isArray(data)?data:[];
    renderClientsKpis(allClients);
    renderClientsTable(getFilteredClients());
    const navEl=document.getElementById('navCountClients');if(navEl)navEl.textContent=allClients.length;
    const dashEl=document.getElementById('statClients');if(dashEl)dashEl.textContent=allClients.length;
  }catch(e){
    const tbody2=document.getElementById('clientsTable');
    if(tbody2)tbody2.innerHTML='<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--re)"><span class="mat sm">error</span>No Clients</td></tr>';
  }
}

function clientManagerOf(c){return c.account_manager_id||c.account_manager||c.owner_id||'';}
function clientSourceOf(c){
  if(c.utm_source)return c.utm_source;
  const rl=c.lead_id?allLeads.find(l=>l.id==c.lead_id):null;
  return (rl&&rl.utm_source)||'';
}

function getFilteredClients(){
  let list=allClients;
  if(clientsFilterMode!=='all'){
    list=list.filter(c=>(c.status||c.lead_status||'Active').toLowerCase()===clientsFilterMode.toLowerCase());
  }
  if(clientsSearchQuery){
    const q=clientsSearchQuery.toLowerCase();
    list=list.filter(c=>{
      const name=((c.first_name||'')+' '+(c.last_name||'')).trim();
      return (c.company_name||'').toLowerCase().includes(q)||name.toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q);
    });
  }
  
  if(clientsAdvFilters.manager){
    list=list.filter(c=>clientManagerOf(c)===clientsAdvFilters.manager);
  }
  if(clientsAdvFilters.source){
    list=list.filter(c=>clientSourceOf(c)===clientsAdvFilters.source);
  }
  if(clientsAdvFilters.dateFrom){
    list=list.filter(c=>{const d=c.created_at||c.converted_at;return !!d&&d.slice(0,10)>=clientsAdvFilters.dateFrom;});
  }
  if(clientsAdvFilters.dateTo){
    list=list.filter(c=>{const d=c.created_at||c.converted_at;return !!d&&d.slice(0,10)<=clientsAdvFilters.dateTo;});
  }
  return list;
}

function filterClientsTable(q){clientsSearchQuery=q;renderClientsTable(getFilteredClients());}

function filterClientsByStatus(mode){
  clientsFilterMode=mode;
  document.querySelectorAll('.client-status-opt').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll(`.client-status-opt[data-status="${mode}"]`).forEach(t=>t.classList.add('active'));
  renderClientsTable(getFilteredClients());
}

function populateAdvancedFilterOptions(){
  const mgrSel=document.getElementById('advFilterManager');
  if(mgrSel){
    const managers=[...new Set(allClients.map(clientManagerOf).filter(Boolean))].sort((a,b)=>(closersMap[a]||a).localeCompare(closersMap[b]||b));
    mgrSel.innerHTML='<option value="">All Managers</option>'+managers.map(m=>`<option value="${m}">${closersMap[m]||m}</option>`).join('');
    mgrSel.value=clientsAdvFilters.manager;
  }
  const srcSel=document.getElementById('advFilterSource');
  if(srcSel){
    const sources=[...new Set(allClients.map(clientSourceOf).filter(Boolean))].sort();
    srcSel.innerHTML='<option value="">All Sources</option>'+sources.map(s=>`<option value="${s}">${s}</option>`).join('');
    srcSel.value=clientsAdvFilters.source;
  }
  const dfEl=document.getElementById('advFilterDateFrom');if(dfEl)dfEl.value=clientsAdvFilters.dateFrom;
  const dtEl=document.getElementById('advFilterDateTo');if(dtEl)dtEl.value=clientsAdvFilters.dateTo;
}

function updateFiltersBadge(){
  const badgeEl=document.getElementById('clientsFiltersBadge');if(!badgeEl)return;
  let count=0;
  if(clientsAdvFilters.manager)count++;
  if(clientsAdvFilters.source)count++;
  if(clientsAdvFilters.dateFrom)count++;
  if(clientsAdvFilters.dateTo)count++;
  if(count>0){badgeEl.style.display='inline-flex';badgeEl.textContent=count;}
  else{badgeEl.style.display='none';}
}

async function toggleFiltersPopover(event){
  if(event)event.stopPropagation();
  const pop=document.getElementById('clientsFiltersPopover');if(!pop)return;
  if(pop.classList.contains('open')){closeFiltersPopover();}
  else{
    pop.classList.add('open');
    document.getElementById('clientsFiltersBtn')?.classList.add('on');
    const mgrSel=document.getElementById('advFilterManager');
    if(mgrSel)mgrSel.innerHTML='<option value="">Loading managers…</option>';
    await ensureClosersLoaded();
    populateAdvancedFilterOptions();
  }
}

function closeFiltersPopover(){
  const pop=document.getElementById('clientsFiltersPopover');
  if(pop)pop.classList.remove('open');
  document.getElementById('clientsFiltersBtn')?.classList.remove('on');
}

function setDatePreset(days){
  const to=new Date();
  const from=new Date();
  from.setDate(from.getDate()-days);
  const fmt=d=>d.toISOString().slice(0,10);
  document.getElementById('advFilterDateFrom').value=fmt(from);
  document.getElementById('advFilterDateTo').value=fmt(to);
}

function applyAdvancedFilters(){
  clientsAdvFilters.manager=document.getElementById('advFilterManager').value;
  clientsAdvFilters.source=document.getElementById('advFilterSource').value;
  clientsAdvFilters.dateFrom=document.getElementById('advFilterDateFrom').value;
  clientsAdvFilters.dateTo=document.getElementById('advFilterDateTo').value;
  renderClientsTable(getFilteredClients());
  updateFiltersBadge();
  closeFiltersPopover();
}

function resetAdvancedFilters(){
  clientsAdvFilters={manager:'',source:'',dateFrom:'',dateTo:''};
  populateAdvancedFilterOptions();
  updateFiltersBadge();
  filterClientsByStatus('all');
}

document.addEventListener('click',e=>{
  const wrap=document.getElementById('clientsFiltersWrap');
  if(wrap&&!wrap.contains(e.target))closeFiltersPopover();
});

function toggleSelectAllClients(cb){
  document.querySelectorAll('#clientsTable input[type=checkbox]').forEach(c=>c.checked=cb.checked);
}

function renderClientsTable(clients){
  const tbody=document.getElementById('clientsTable');
  const countEl=document.getElementById('clientsCount');
  if(countEl)countEl.textContent=clients.length+' client'+(clients.length!==1?'s':'');
  if(!clients.length){
    tbody.innerHTML='<tr><td colspan="10"><div class="empty-state"><span class="mat">groups</span><p>No clients found.</p><button class="abtn pri" onclick="navigate(\'opportunities\')"><span class="mat sm">people</span>View Leads</button></div></td></tr>';
    return;
  }
  tbody.innerHTML=clients.map(c=>{
    const name=((c.first_name||'')+' '+(c.last_name||'')).trim()||'—';
    const mgr=c.account_manager_id||c.account_manager||c.owner_id||'—';
    const status=c.status||c.lead_status||'Active';
    const stCls={Won:'gr',Lost:'re',Potential:'bl',Active:'gr'}[status]||'gy';
    const init=initials(c.company_name||name);
    const lid=c.lead_id?'#'+c.lead_id:'—';
    const created=fmtDate(c.created_at||c.converted_at);
    const cid=c.id||0;
    return `<tr onclick="openClientDetail(${cid})" style="cursor:pointer">
      <td onclick="event.stopPropagation()"><input type="checkbox" style="accent-color:var(--acc)"/></td>
      <td><div style="display:flex;align-items:center;gap:9px">
        <div style="width:30px;height:30px;border-radius:7px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--acc);flex-shrink:0">${init}</div>
        <div><div style="font-weight:600;font-size:14px">${c.company_name||'—'}</div><div style="font-size:12px;color:var(--tx3)">${c.website||''}</div></div>
      </div></td>
      <td style="font-size:14px">${name}</td>
      <td><span class="badge ${stCls}">${status}</span></td>
      <td style="font-size:13px;color:var(--tx2)">${mgr}</td>
      <td>${c.email?`<a href="mailto:${c.email}" style="color:var(--acc);text-decoration:none;font-size:13px" onclick="event.stopPropagation()">${c.email}</a>`:'<span style="color:var(--tx3)">—</span>'}</td>
      <td style="font-size:13px;color:var(--tx2)">${c.phone||'—'}</td>
      <td style="font-size:13px;font-family:monospace;color:var(--tx3)">${lid}</td>
      <td style="font-size:13px;color:var(--tx3)">${created}</td>
      <td onclick="event.stopPropagation()"><button class="tbb" style="width:28px;height:28px" onclick="openClientDetail(${cid})"><span class="mat sm">chevron_right</span></button></td>
    </tr>`;
  }).join('');
}

function openClientDetail(id){
  const c=allClients.find(x=>x.id==id);if(!c)return;
  currentClient=c;
  document.querySelectorAll('#clientsTable tr').forEach(r=>r.classList.remove('cdp-row-sel'));
  const rows=document.querySelectorAll('#clientsTable tr');
  rows.forEach(r=>{if(r.onclick&&r.onclick.toString().includes(id))r.classList.add('cdp-row-sel');});
  const name=((c.first_name||'')+' '+(c.last_name||'')).trim()||'—';
  const status=c.status||c.lead_status||'Active';
  const mgr=c.account_manager_id||c.account_manager||c.owner_id||'—';
  const since=fmtDate(c.created_at||c.converted_at);
  const st=id2=>v=>{const e=document.getElementById(id2);if(e)e.textContent=v;};
  st('cdp-company')(c.company_name||'—');
  st('cdp-since')('Client since '+since);
  st('cdp-sub')(name+(c.website?' · '+c.website:''));
  const badgeEl=document.getElementById('cdp-status-badge');if(badgeEl)badgeEl.textContent=status;
  const eb=document.getElementById('cdp-email-btn');
  if(eb){eb.onclick=c.email?()=>window.open('mailto:'+c.email):null;eb.style.opacity=c.email?'1':'0.45';}
  const cb2=document.getElementById('cdp-call-btn');
  if(cb2){cb2.onclick=c.phone?()=>window.open('tel:'+c.phone):null;cb2.style.opacity=c.phone?'1':'0.45';}
  st('cdp-fname')(c.first_name||'—');
  st('cdp-lname')(c.last_name||'—');
  const emailEl=document.getElementById('cdp-email-val');
  if(emailEl)emailEl.innerHTML=c.email?`<a href="mailto:${c.email}" style="color:var(--acc);text-decoration:none">${c.email}</a>`:'<span style="color:var(--tx3)">—</span>';
  const phoneEl=document.getElementById('cdp-phone-val');
  if(phoneEl)phoneEl.innerHTML=c.phone?`<a href="tel:${c.phone}" style="color:var(--acc);text-decoration:none">${c.phone}</a>`:'<span style="color:var(--tx3)">—</span>';
  const webEl=document.getElementById('cdp-website');
  if(webEl)webEl.innerHTML=c.website?`<a href="${c.website.startsWith('http')?c.website:'https://'+c.website}" target="_blank" style="color:var(--acc);text-decoration:none">${c.website}</a>`:'<span style="color:var(--tx3)">—</span>';
  st('cdp-id')(c.id?'#'+c.id:'—');
  st('cdp-lead-id')(c.lead_id?'#'+c.lead_id:'—');
  st('cdp-manager')(mgr);
  const stEl=document.getElementById('cdp-status-val');
  if(stEl){const sc={Won:'gr',Lost:'re',Potential:'bl',Active:'gr'}[status]||'gy';stEl.innerHTML=`<span class="badge ${sc}">${status}</span>`;}
  const relLead=c.lead_id?allLeads.find(l=>l.id==c.lead_id):null;
  const leadNotes = relLead?.notes || '';
  st('cdp-lead-status')(relLead?relLead.status:(c.lead_status||'—'));
  st('cdp-pipeline')(relLead?relLead.pipeline_stage||'—':(c.pipeline_stage||'—'));
  st('cdp-created')(since);
  const noteArea = document.getElementById('cdpNoteArea');

if (noteArea) {
    noteArea.value = leadNotes;
}

st('cdp-activity-summary')(
    leadNotes || 'No notes yet. Add one above.'
);
  buildCdpTimeline(c,relLead);
  document.getElementById('clientDetailPanel').style.right='0';
  document.getElementById('clientsTableWrap').style.marginRight='480px';
  switchCdpTab('overview'); 
}
function buildCdpTimeline(c,relLead){
  const tl=document.getElementById('cdpTimeline');if(!tl)return;
  const events=[];
  if(c.created_at)events.push({dot:'ac',txt:'Client record created',meta:fmtDate(c.created_at)});
  if(relLead&&relLead.created_at)events.push({dot:'bl',txt:'Lead created',meta:fmtDate(relLead.created_at)});
  if(relLead&&relLead.last_contacted_at)events.push({dot:'bl',txt:'Lead last contacted',meta:fmtDate(relLead.last_contacted_at)});
  if(relLead&&relLead.preferred_date)events.push({dot:'am',txt:'Meeting scheduled',meta:fmtDate(relLead.preferred_date)+(relLead.preferred_time?' · '+fmtTime(relLead.preferred_time):'')});
  if(relLead&&relLead.converted_at)events.push({dot:'gr',txt:'Converted to client',meta:fmtDate(relLead.converted_at)});
  if(c.notes)events.push({dot:'gy',txt:'Note on file',meta:'See Notes tab'});
  if(!events.length){tl.innerHTML='<div style="font-size:13px;color:var(--tx3);padding:10px 0">No timeline events yet.</div>';return;}
  tl.innerHTML='<div style="position:absolute;left:4px;top:8px;bottom:8px;width:1px;background:var(--bd)"></div>'+
    events.map(e=>`<div style="display:flex;gap:10px;padding:8px 0;position:relative"><div style="width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px;border:2px solid;z-index:1;position:relative;border-color:var(--${e.dot==='ac'?'acc':e.dot==='gy'?'tx3':e.dot});background:rgba(255,255,255,0.04)"></div><div><div style="font-size:13px;font-weight:600;color:var(--tx)">${e.txt}</div><div style="font-size:12px;color:var(--tx3);margin-top:2px">${e.meta}</div></div></div>`).join('');
}

function closeClientPanel(){
  document.getElementById('clientDetailPanel').style.right='-500px';
  document.getElementById('clientsTableWrap').style.marginRight='0';
  currentClient=null;
}

function switchCdpTab(tab){
  document.querySelectorAll('.cdp-tab').forEach(t=>{
    const active=t.id==='cdpTab-'+tab;
    t.style.color=active?'var(--acc)':'var(--tx3)';
    t.style.borderBottomColor=active?'var(--acc)':'transparent';
  });
  ['overview','notes','activity','reviews'].forEach(p=>{
    const el=document.getElementById('cdpPanel-'+p);
    if(el)el.style.display=p===tab?'flex':'none';
  });
  if(tab==='reviews')renderCdpReviewsTab();
}

function cdpOpenLead(){
  if(!currentClient)return;
  const lid=currentClient.lead_id;
  if(!lid){toast('No related lead ID on this client.','err');return;}
  const lead=allLeads.find(l=>l.id==lid);
  if(lead){openLead(lead.id);}else{toast('Lead #'+lid+' not found.','err');}
}

function cdpEdit(){
  if(!currentClient)return;
  const lid=currentClient.lead_id;
  if(lid){const lead=allLeads.find(l=>l.id==lid);if(lead){currentLead=lead;lpEdit();return;}}
  toast('No linked lead to edit.','err');
}

async function cdpSaveNote(){
  if(!currentClient)return;
  const note=document.getElementById('cdpNoteArea').value;
  const lid=currentClient.lead_id;
  if(!lid){toast('No linked lead — cannot save note.','err');return;}
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_lead',id:parseInt(lid),notes:note})});
    if(!res.ok)throw new Error();
    currentClient.notes=note;
    const idx=allClients.findIndex(c=>c.id===currentClient.id);if(idx>-1)allClients[idx].notes=note;
    const sumEl=document.getElementById('cdp-activity-summary');if(sumEl)sumEl.textContent=note||'No notes yet.';
    toast('✓ Note saved','ok');
  }catch(e){toast('Failed to save note.','err');}
}

async function cdpDelete() {
  if (!currentClient) return;

  showConfirm(
    'Delete Client',
    `Delete "${currentClient.company_name || 'this client'}"? This will remove only the client record. The lead will remain.`,
    'Delete',
    'danger',
    async () => {
      try {
        const res = await fetch(API.leadManagement, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'delete_client',
            id: Number(currentClient.id)
          })
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        allClients = allClients.filter(c => c.id !== currentClient.id);

        if (typeof renderClientsTable === 'function') {
          renderClientsTable(allClients);
        }

        if (typeof cwRenderClientsTable === 'function') {
          cwRenderClientsTable(allClients);
        }

        const count = document.getElementById('clientsCount');
        if (count) {
          count.textContent = `${allClients.length} client${allClients.length !== 1 ? 's' : ''}`;
        }

        document.getElementById('clientDetailPanel').style.right = '-500px';
        document.getElementById('clientsTableWrap').style.marginRight = '0';

        currentClient = null;

        toast('✓ Client deleted successfully', 'ok');

      } catch (e) {
        console.error(e);
        toast('Failed to delete client.', 'err');
      }
    }
  );
}
async function loadActivity(){
  document.getElementById('activityFeed').innerHTML=`<div style="text-align:center;padding:32px;color:var(--tx3)"><span class="spin mat sm">sync</span> Loading…</div>`;
  try{const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get_activities'})});const data=await res.json();renderActivityFeed(Array.isArray(data)?data:(data.activities||[]));}
  catch(e){renderActivityFeed(deriveSyntheticActivity(allLeads));}
  renderActivitySummary();
}
function deriveSyntheticActivity(leads){const events=[];leads.forEach(l=>{if(l.created_at)events.push({type:'created',description:`Lead created — ${l.company_name||'Unknown'}`,created_at:l.created_at,lead_id:l.id});if(l.last_contacted_at)events.push({type:'contacted',description:`Contacted — ${l.company_name||'Unknown'}`,created_at:l.last_contacted_at,lead_id:l.id});if(l.converted_at)events.push({type:'converted',description:`Converted to client — ${l.company_name||'Unknown'}`,created_at:l.converted_at,lead_id:l.id});});return events.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,30);}
function activityIcon(type){const map={created:{cls:'ac',icon:'add_circle'},contacted:{cls:'bl',icon:'call'},converted:{cls:'gr',icon:'verified'},won:{cls:'gr',icon:'check_circle'},lost:{cls:'re',icon:'cancel'},note:{cls:'am',icon:'sticky_note_2'},meeting:{cls:'pu',icon:'event'},email:{cls:'ac',icon:'mail'},status:{cls:'am',icon:'swap_horiz'},review:{cls:'pu',icon:'reviews'},default:{cls:'gy',icon:'history'}};const t=(type||'').toLowerCase();for(const[k,v]of Object.entries(map)){if(t.includes(k))return v;}return map.default;}
function renderActivityFeed(activities){const el=document.getElementById('activityFeed');if(!activities.length){el.innerHTML=`<div class="empty-state"><span class="mat">history_toggle_off</span><p>No activity recorded yet.</p></div>`;return;}el.innerHTML=activities.map((a,i)=>{const{cls,icon}=activityIcon(a.type||a.activity_type||'');return `<div class="arow" style="${i===activities.length-1?'border-bottom:none':''}"><div class="activity-icon ${cls}"><span class="mat sm">${icon}</span></div><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500;color:var(--tx)">${a.description||a.message||a.text||'Activity recorded'}</div><div style="font-size:11px;color:var(--tx3);margin-top:2px">${fmtDate(a.created_at||a.date)}${a.lead_id?' · Lead #'+a.lead_id:''}</div></div></div>`;}).join('');}
function renderActivitySummary(){const el=document.getElementById('activitySummary');if(!el)return;const total=allLeads.length,potential=allLeads.filter(l=>l.status==='Potential').length,won=allLeads.filter(l=>l.status==='Won').length,lost=allLeads.filter(l=>l.status==='Lost').length,nc=allLeads.filter(l=>!l.last_contacted_at).length;el.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:5px"><span style="font-size:13px;color:var(--tx2)">Total Leads</span><span style="font-weight:700;font-size:15px">${total}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:5px"><span style="font-size:13px;color:var(--tx2)">Potential</span><span style="font-weight:700;color:var(--bl)">${potential}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:5px"><span style="font-size:13px;color:var(--tx2)">Won</span><span style="font-weight:700;color:var(--gr)">${won}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--bg);border-radius:5px"><span style="font-size:13px;color:var(--tx2)">Lost</span><span style="font-weight:700;color:var(--re)">${lost}</span></div><div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:${nc>0?'var(--re-d)':'var(--bg)'};border-radius:5px"><span style="font-size:13px;color:var(--tx2)">Never Contacted</span><span style="font-weight:700;color:${nc>0?'var(--re)':'var(--tx3)'}">${nc}</span></div>`;}

function renderCalendar(){
  const mn=['January','February','March','April','May','June','July','August','September','October','November','December'];
  setEl('calMonthTitle',`${mn[calMonth]} ${calYear}`);
  const today=new Date(),todayStr=today.toISOString().slice(0,10),eventMap={};
  allLeads.forEach(l=>{if(!l.preferred_date)return;const d=l.preferred_date.slice(0,10);if(!eventMap[d])eventMap[d]=[];eventMap[d].push(l);});
  const firstDay=new Date(calYear,calMonth,1),lastDay=new Date(calYear,calMonth+1,0);
  let startOffset=(firstDay.getDay()+6)%7,html='';
  for(let i=0;i<startOffset;i++){const d=new Date(firstDay);d.setDate(d.getDate()-(startOffset-i));html+=`<div class="cal-cell other-month"><div class="cal-day" style="color:var(--tx3)">${d.getDate()}</div></div>`;}
  for(let day=1;day<=lastDay.getDate();day++){const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;const isToday=ds===todayStr,events=eventMap[ds]||[];const evHtml=events.slice(0,3).map(l=>`<div class="cal-event st-${l.status||'Potential'}" onclick="event.stopPropagation();mhCalEventClick(${l.id})" title="${l.company_name||'Lead'}">${l.preferred_time?`<span style="opacity:0.7">${fmtTime(l.preferred_time)}</span> `:''} ${l.company_name||'Lead'}</div>`).join('');const more=events.length>3?`<div style="font-size:10px;color:var(--tx3);padding:1px 4px">+${events.length-3} more</div>`:'';html+=`<div class="cal-cell${isToday?' today':''}"><div class="cal-day">${day}</div>${evHtml}${more}</div>`;}
  const remainder=(startOffset+lastDay.getDate())%7===0?0:7-((startOffset+lastDay.getDate())%7);
  for(let i=1;i<=remainder;i++)html+=`<div class="cal-cell other-month"><div class="cal-day" style="color:var(--tx3)">${i}</div></div>`;
  document.getElementById('calGrid').innerHTML=html;
}
function calPrev(){calMonth--;if(calMonth<0){calMonth=11;calYear--;}renderCalendar();}
function calNext(){calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCalendar();}
function calGoToday(){const n=new Date();calYear=n.getFullYear();calMonth=n.getMonth();renderCalendar();}

function openLead(id){
  const lead=allLeads.find(l=>l.id==id);if(!lead)return;
  currentLead=lead;
  const sc=scClass(lead.status),name=((lead.first_name||'')+' '+(lead.last_name||'')).trim()||'—',status=lead.status||'Potential';
  document.getElementById('lp-company').textContent=lead.company_name||'—';
  document.getElementById('lp-tier').textContent=lead.utm_source?`Source: ${lead.utm_source}`:'Lead';
  document.getElementById('lp-sub').textContent=name+(lead.utm_campaign?' · '+lead.utm_campaign:'');
  document.getElementById('lp-badges').innerHTML=`<span class="badge ${sc}">${status}</span>`+(lead.utm_source?`<span class="badge gy">${lead.utm_source}</span>`:'')+( lead.converted_at?`<span class="badge gr"><span class="mat sm" style="font-size:11px">verified</span>Converted</span>`:'');
  const qg=document.getElementById('lp-quick-grid');
  if(qg){
    const eb=lead.email?`<a class="lp-quick-btn" href="mailto:${lead.email}"><span class="mat">mail</span><span class="qlabel">Email</span></a>`:`<div class="lp-quick-btn" style="opacity:0.4;cursor:not-allowed"><span class="mat">mail</span><span class="qlabel">Email</span></div>`;
    const cb=lead.phone?`<a class="lp-quick-btn" href="tel:${lead.phone}"><span class="mat">call</span><span class="qlabel">Call</span></a>`:`<div class="lp-quick-btn" style="opacity:0.4;cursor:not-allowed"><span class="mat">call</span><span class="qlabel">Call</span></div>`;
    qg.innerHTML=eb+cb+`<div class="lp-quick-btn" onclick="navigate('meetings')"><span class="mat">calendar_today</span><span class="qlabel">Schedule</span></div>`;
  }
  document.getElementById('btnWon').disabled=status==='Won';
  document.getElementById('btnLost').disabled=status==='Lost';
  document.getElementById('btnPotential').disabled=status==='Potential';
  document.getElementById('leadContent').innerHTML=`
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">payments</span><span class="lp-card-title">Deal Metadata</span></div>
    <div class="lp-bento">
      <div class="lp-bento-cell"><div class="lp-bento-lbl">Status</div><div class="lp-bento-val"><span class="badge ${sc}">${status}</span></div></div>
      <div class="lp-bento-cell"><div class="lp-bento-lbl">Source</div><div class="lp-bento-val" style="font-size:14px">${lead.utm_source||'—'}</div></div>
      <div class="lp-bento-cell"><div class="lp-bento-lbl">Pipeline Stage</div><div class="lp-bento-val" style="font-size:14px">${lead.pipeline_stage||'New'}</div></div>
      <div class="lp-bento-cell"><div class="lp-bento-lbl">Owner</div><div class="lp-bento-val" style="font-size:14px">${lead.owner_id||'—'}</div></div>
    </div></div>
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">insights</span><span class="lp-card-title">Funnel Data</span></div>
    <div style="padding:11px 13px;display:flex;flex-direction:column;gap:10px">
      <div class="form-group">
        <label class="form-label">Deal Value ($)</label>
        <div style="display:flex;gap:6px">
          <input type="number" class="form-input" id="lpDealValue" placeholder="0.00" value="${lead.deal_value||''}" min="0" step="0.01"/>
          <button class="abtn" style="flex-shrink:0" onclick="lpSaveDealValue()"><span class="mat sm">save</span></button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Meeting Outcome</label>
        <div class="tgroup" id="lpShowStatusGroup" style="width:fit-content">
          <div class="topt${lead.show_status==='showed'?' active':''}" onclick="lpSetShowStatus('showed')">Showed</div>
          <div class="topt${lead.show_status==='no_show'?' active':''}" onclick="lpSetShowStatus('no_show')">No-Show</div>
          <div class="topt${!lead.show_status?' active':''}" onclick="lpSetShowStatus('')">Pending</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Offer Made?</label>
        <div class="tgroup" id="lpOfferGroup" style="width:fit-content">
          <div class="topt${lead.offer_made===true?' active':''}" onclick="lpSetOfferMade(true)">Yes</div>
          <div class="topt${lead.offer_made===false||lead.offer_made===undefined?' active':''}" onclick="lpSetOfferMade(false)">No</div>
        </div>
      </div>
    </div></div>
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">person</span><span class="lp-card-title">Contact</span><span class="mat sm" style="margin-left:auto;cursor:pointer;color:var(--tx3)" onclick="lpEdit()">edit</span></div>
    <div class="lp-rows">
      <div class="lp-row"><div class="lp-ri"><span class="mat">badge</span></div><div><div class="lp-rl">Full Name</div><div class="lp-rv">${name}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">mail</span></div><div><div class="lp-rl">Email</div><div class="lp-rv">${lead.email?`<a href="mailto:${lead.email}">${lead.email}</a>`:'—'}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">call</span></div><div><div class="lp-rl">Phone</div><div class="lp-rv">${lead.phone?`<a href="tel:${lead.phone}">${lead.phone}</a>`:'—'}</div></div></div>
    </div></div>
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">calendar_today</span><span class="lp-card-title">Scheduling</span></div>
    <div class="lp-rows">
      <div class="lp-row"><div class="lp-ri"><span class="mat">event</span></div><div><div class="lp-rl">Preferred Date</div><div class="lp-rv">${fmtDate(lead.preferred_date)}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">schedule</span></div><div><div class="lp-rl">Preferred Time</div><div class="lp-rv">${fmtTime(lead.preferred_time)}${lead.preferred_timezone?` <span style="color:var(--tx3);font-weight:400">(${lead.preferred_timezone})</span>`:''}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">history</span></div><div><div class="lp-rl">Last Contacted</div><div class="lp-rv" style="${!lead.last_contacted_at?'color:var(--tx3)':''}">${lead.last_contacted_at?fmtDate(lead.last_contacted_at):'Never contacted'}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">alarm</span></div><div><div class="lp-rl">Next Follow-Up</div><div class="lp-rv" style="${lead.next_followup_at?'color:var(--am)':'color:var(--tx3)'}">${lead.next_followup_at?fmtDate(lead.next_followup_at):'Not set'}</div></div></div>
      ${lead.converted_at?`<div class="lp-row"><div class="lp-ri"><span class="mat">verified</span></div><div><div class="lp-rl">Converted At</div><div class="lp-rv" style="color:var(--gr)">${fmtDate(lead.converted_at)}</div></div></div>`:''}
    </div></div>
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">sticky_note_2</span><span class="lp-card-title">Strategic Notes</span>
      <span style="font-size:11px;color:var(--tx3);margin-left:auto">${lead.notes?'Has notes':'No notes'}</span>
      <button class="abtn" style="margin-left:8px;padding:3px 9px;font-size:12px" onclick="saveNote()"><span class="mat sm">save</span>Save</button>
    </div>
    <div style="padding:10px 13px"><textarea class="lp-notes" id="noteArea" placeholder="Add strategic notes about this lead…">${lead.notes||''}</textarea></div></div>
    <div class="lp-card"><div class="lp-card-hd"><span class="mat">timeline</span><span class="lp-card-title">Communication Log</span></div>
    <div class="lp-tl-wrap">${buildTimeline(lead)}</div></div>`;
  document.getElementById('leadPanel').classList.add('lp-open');
  document.getElementById('lpOverlay').classList.add('show');
}
function buildTimeline(lead){
  const events=[];
  if(lead.created_at)events.push({dot:'ac',icon:'add_circle',text:'Lead created',meta:fmtDate(lead.created_at)});
  if(lead.last_contacted_at)events.push({dot:'bl',icon:'call',text:'Last contacted',meta:fmtDate(lead.last_contacted_at)});
  if(lead.preferred_date)events.push({dot:'am',icon:'event',text:'Appointment scheduled',meta:`${fmtDate(lead.preferred_date)} ${fmtTime(lead.preferred_time)}`});
  if(lead.next_followup_at)events.push({dot:'am',icon:'alarm',text:'Follow-up scheduled',meta:fmtDate(lead.next_followup_at)});
  if(lead.converted_at)events.push({dot:'gr',icon:'verified',text:'Converted to client',meta:fmtDate(lead.converted_at)});
  if(lead.status==='Won'&&!lead.converted_at)events.push({dot:'gr',icon:'check_circle',text:'Marked as Won',meta:'Status update'});
  if(lead.status==='Lost')events.push({dot:'re',icon:'cancel',text:'Marked as Lost',meta:'Status update'});
  if(lead.notes)events.push({dot:'gy',icon:'sticky_note_2',text:'Note on file',meta:'See Strategic Notes'});
  if(!events.length)return`<div style="padding:16px;text-align:center;font-size:13px;color:var(--tx3)">No activity recorded yet.</div>`;
  return events.map(e=>`<div class="lp-tl-item"><div class="lp-tl-dot ${e.dot}"><span class="mat">${e.icon}</span></div><div class="lp-tl-content"><div class="lp-tl-txt">${e.text}</div><div class="lp-tl-meta">${e.meta}</div></div></div>`).join('');
}
function closeLeadPanel(){document.getElementById('leadPanel').classList.remove('lp-open');document.getElementById('lpOverlay').classList.remove('show');}
async function lpStatus(newStatus){
  if(!currentLead)return;
  const btnMap={Won:'btnWon',Lost:'btnLost',Potential:'btnPotential'};
  const btn=document.getElementById(btnMap[newStatus]);if(btn)btn.disabled=true;
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_status',id:currentLead.id,status:newStatus})});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
   await loadLeads();

if (typeof loadClients === 'function') {
  await loadClients();
}

renderTable(
  activeFilter === 'all'
    ? allLeads
    : allLeads.filter(l => l.status === activeFilter)
);

updateDashboard();
updateSidebarCounts();

if (activityLoaded) {
  activityLoaded = false;
  loadActivity();
  activityLoaded = true;
}

const updatedLead = allLeads.find(l => l.id === currentLead.id);
if (updatedLead) {
  currentLead = updatedLead;
  openLead(updatedLead.id);
}

toast(`✓ Status updated to ${newStatus}`, 'ok');
  }catch(e){toast('Failed to update status.','err');if(btn)btn.disabled=false;}
}
async function saveNote(){
  if(!currentLead)return;const note=document.getElementById('noteArea').value;
  try{const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_lead',id:currentLead.id,notes:note})});if(!res.ok)throw new Error(`HTTP ${res.status}`);currentLead.notes=note;const idx=allLeads.findIndex(l=>l.id===currentLead.id);if(idx>-1)allLeads[idx].notes=note;toast('✓ Note saved','ok');}
  catch(e){toast('Failed to save note.','err');}
}
/* --- Funnel Metrics data capture: these three fields (deal_value, show_status,
   offer_made) don't come from the landing page — they're entered here, in the
   dashboard, after a rep talks to the lead. Each POST reuses the leadManagement
   webhook with a new `action` value your n8n workflow needs to handle:
   'update_deal_value' {id, deal_value}, 'update_show_status' {id, show_status:
   'showed'|'no_show'|''}, 'update_offer_made' {id, offer_made:true|false}. */
async function lpSaveDealValue(){
  if(!currentLead)return;
  const val=parseFloat(document.getElementById('lpDealValue').value)||0;
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_deal_value',id:currentLead.id,deal_value:val})});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    currentLead.deal_value=val;const idx=allLeads.findIndex(l=>l.id===currentLead.id);if(idx>-1)allLeads[idx].deal_value=val;
    toast('✓ Deal value saved','ok');
  }catch(e){toast('Failed to save deal value — check the update_deal_value webhook.','err');}
}
async function lpSetShowStatus(val){
  if(!currentLead)return;
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_show_status',id:currentLead.id,show_status:val})});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    currentLead.show_status=val;const idx=allLeads.findIndex(l=>l.id===currentLead.id);if(idx>-1)allLeads[idx].show_status=val;
    const g=document.getElementById('lpShowStatusGroup');
    if(g)g.querySelectorAll('.topt').forEach(t=>t.classList.remove('active'));
    if(g){const map={showed:0,no_show:1,'':2};g.children[map[val]].classList.add('active');}
    toast('✓ Meeting outcome saved','ok');
  }catch(e){toast('Failed to save — check the update_show_status webhook.','err');}
}
async function lpSetOfferMade(val){
  if(!currentLead)return;
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_offer_made',id:currentLead.id,offer_made:val})});
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    currentLead.offer_made=val;const idx=allLeads.findIndex(l=>l.id===currentLead.id);if(idx>-1)allLeads[idx].offer_made=val;
    const g=document.getElementById('lpOfferGroup');
    if(g){g.querySelectorAll('.topt').forEach(t=>t.classList.remove('active'));g.children[val?0:1].classList.add('active');}
    toast('✓ Offer status saved','ok');
  }catch(e){toast('Failed to save — check the update_offer_made webhook.','err');}
}
function lpEdit(){
  if(!currentLead)return;
  document.getElementById('modalTitle').textContent='Edit Lead';document.getElementById('modalLeadId').value=currentLead.id;
  document.getElementById('mFirstName').value=currentLead.first_name||'';document.getElementById('mLastName').value=currentLead.last_name||'';
  document.getElementById('mEmail').value=currentLead.email||'';document.getElementById('mPhone').value=currentLead.phone||'';
  document.getElementById('mCompany').value=currentLead.company_name||'';document.getElementById('mStatus').value=currentLead.status||'Potential';
  document.getElementById('mOwner').value=currentLead.owner_id||'';document.getElementById('mPrefDate').value=currentLead.preferred_date||'';
  document.getElementById('mPrefTime').value=currentLead.preferred_time||'';document.getElementById('mUtmSource').value=currentLead.utm_source||'';
  document.getElementById('mUtmCampaign').value=currentLead.utm_campaign||'';document.getElementById('mUtmMedium').value=currentLead.utm_medium||'';
  document.getElementById('mUtmContent').value=currentLead.utm_content||'';document.getElementById('mNotes').value=currentLead.notes||'';
  document.getElementById('modal').classList.add('open');
}
async function lpConvert() {
  if (!currentLead) return;

  showConfirm(
    'Convert to Client',
    'This will mark the lead as Won and create a client record. Continue?',
    'Convert',
    'pri',
    async () => {
      try {
        const res = await fetch(API.leadManagement, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'update_status',
            id: currentLead.id,
            status: 'Won'
          })
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        await loadLeads();

        if (typeof loadClients === 'function') {
          await loadClients();
        }

        updateDashboard();
        updateSidebarCounts();

        const updatedLead = allLeads.find(l => l.id === currentLead.id);
        if (updatedLead) {
          openLead(updatedLead.id);
        }

        toast('✓ Lead converted successfully', 'ok');

      } catch (e) {
        console.error(e);
        toast('Conversion failed. Check webhook.', 'err');
      }
    }
  );
}
async function lpDelete(){
  if(!currentLead)return;
  showConfirm('Delete Lead',`Delete "${currentLead.company_name||'this lead'}"? This cannot be undone.`,'Delete','danger',async()=>{
    try{const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete_lead',id:currentLead.id})});if(!res.ok)throw new Error(`HTTP ${res.status}`);
      allLeads=allLeads.filter(l=>l.id!==currentLead.id);closeLeadPanel();renderTable(activeFilter==='all'?allLeads:allLeads.filter(l=>l.status===activeFilter));updateDashboard();updateSidebarCounts();toast('Lead deleted','ok');}
    catch(e){toast('Failed to delete lead.','err');}
  });
}
async function loadClosers() {

    const select = document.getElementById("mOwner");

    select.innerHTML = '<option value="">Loading...</option>';

    try {

        const response = await fetch(
            "https://n8n.upleaddigital.com/webhook/get-closers"
        );

        if (!response.ok) throw new Error(await response.text());

        const closers = await response.json();

        select.innerHTML = '<option value="">Select a closer...</option>';

        closers.forEach(user => {
            const option = document.createElement("option");
            option.value = user.id;
            option.textContent = user.full_name;
            select.appendChild(option);
            closersMap[user.id]=user.full_name;
        });
        closersLoaded=true;

    } catch (err) {
        console.error(err);
        select.innerHTML = '<option value="">Unable to load closers</option>';
    }
} 
async function ensureClosersLoaded(){
  if(closersLoaded)return;
  try{
    const response=await fetch("https://n8n.upleaddigital.com/webhook/get-closers");
    if(!response.ok)throw new Error(await response.text());
    const closers=await response.json();
    closers.forEach(user=>{closersMap[user.id]=user.full_name;});
    closersLoaded=true;
  }catch(e){console.error(e);}
}
async function openCreateLead() {

  await loadClosers();

  document.getElementById('modalTitle').textContent = 'New Lead';
  document.getElementById('modalLeadId').value = '';

  [
    'mFirstName',
    'mLastName',
    'mEmail',
    'mPhone',
    'mCompany',
    'mPrefDate',
    'mPrefTime',
    'mUtmSource',
    'mUtmCampaign',
    'mUtmMedium',
    'mUtmContent',
    'mNotes'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('mOwner').selectedIndex = 0;
  document.getElementById('mStatus').value = 'Potential';

  document.getElementById('modal').classList.add('open');

}
function closeModal(){document.getElementById('modal').classList.remove('open');}
async function saveLeadModal(){
  const id=document.getElementById('modalLeadId').value,isEdit=!!id;
  const btn=document.getElementById('modalSaveBtn');btn.disabled=true;btn.innerHTML='<span class="mat sm">hourglass_top</span>Saving…';
  const payload={action:isEdit?'update_lead':'create_lead',first_name:document.getElementById('mFirstName').value.trim(),last_name:document.getElementById('mLastName').value.trim(),email:document.getElementById('mEmail').value.trim(),phone:document.getElementById('mPhone').value.trim(),company_name:document.getElementById('mCompany').value.trim(),status:document.getElementById('mStatus').value,owner_id:document.getElementById('mOwner').value.trim(),preferred_date:document.getElementById('mPrefDate').value||null,preferred_time:document.getElementById('mPrefTime').value||null,utm_source:document.getElementById('mUtmSource').value.trim(),utm_campaign:document.getElementById('mUtmCampaign').value.trim(),utm_medium:document.getElementById('mUtmMedium').value.trim(),utm_content:document.getElementById('mUtmContent').value.trim(),notes:document.getElementById('mNotes').value.trim()};
  if(isEdit)payload.id=parseInt(id);
  if(!payload.company_name&&!payload.email){toast('Company name or email required.','err');btn.disabled=false;btn.innerHTML=`<span class="mat sm">save</span>${isEdit?'Update Lead':'Save Lead'}`;return;}
  try{const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!res.ok)throw new Error(`HTTP ${res.status}`);
    closeModal();toast(isEdit?'✓ Lead updated':'✓ Lead created','ok');
    if(isEdit){const idx=allLeads.findIndex(l=>l.id==id);if(idx>-1)allLeads[idx]={...allLeads[idx],...payload};if(currentLead&&currentLead.id==id){currentLead={...currentLead,...payload};openLead(currentLead.id);}}
    else{await loadLeads();}
      
    renderTable(activeFilter==='all'?allLeads:allLeads.filter(l=>l.status===activeFilter));updateDashboard();updateSidebarCounts();if(page()==='meetings'){renderMhKpis();renderCalendar();} 
     }
  catch(e){toast(isEdit?'Failed to update lead.':'Failed to create lead.','err');}
  finally{btn.disabled=false;btn.innerHTML=`<span class="mat sm">save</span>${isEdit?'Update Lead':'Save Lead'}`;}
}

const PIPELINE_STAGES=[{id:'New',label:'New',color:'#8e909a',dot:'rgba(142,144,154,0.5)'},{id:'Contacted',label:'Contacted',color:'#89ceff',dot:'#89ceff'},{id:'Qualified',label:'Qualified',color:'#d2bbff',dot:'#d2bbff'},{id:'Appointment',label:'Appointment',color:'#fbbf24',dot:'#fbbf24'},{id:'Proposal',label:'Proposal',color:'#f97316',dot:'#f97316'},{id:'Negotiation',label:'Negotiation',color:'#e879f9',dot:'#e879f9'},{id:'Won',label:'Won',color:'#4ade80',dot:'#4ade80'},{id:'Lost',label:'Lost',color:'#f87171',dot:'#f87171'},{id:'Disqualified',label:'Disqualified',color:'#64748b',dot:'#64748b'}];
function defaultStage(lead){
    if (lead.pipeline_stage) return lead.pipeline_stage;

    if (lead.status === 'Won') return 'Won';
    if (lead.status === 'Lost') return 'Lost';
    if (lead.status === 'Disqualified') return 'Disqualified';
    return 'New';
  }
function renderPipeline(){
  const board=document.getElementById('pipelineBoard');if(!board)return;
  if(!allLeads.length){board.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;width:100%;padding:60px;color:var(--tx3);flex-direction:column;gap:10px"><span class="mat" style="font-size:33px;opacity:0.3">view_kanban</span><p style="font-size:14px">No leads yet. <a style="color:var(--acc);cursor:pointer" onclick="openCreateLead()">Create your first lead →</a></p></div>`;return;}
  const grouped={};PIPELINE_STAGES.forEach(s=>grouped[s.id]=[]);
  allLeads.forEach(lead=>{const stage=defaultStage(lead);if(grouped[stage])grouped[stage].push(lead);else grouped['New'].push(lead);});
  const se=document.getElementById('pipelineSummary');if(se){const active=allLeads.filter(l=>!['Won','Lost','Disqualified'].includes(defaultStage(l))).length;se.innerHTML=`<span>${allLeads.length} total</span><span style="color:var(--bd)">·</span><span style="color:var(--gr)">${grouped['Won'].length} won</span><span style="color:var(--bd)">·</span><span style="color:var(--bl)">${active} active</span>`;}
  board.innerHTML=PIPELINE_STAGES.map(stage=>{
    const leads=grouped[stage.id];const cards=leads.length?leads.map(lead=>buildKanbanCard(lead)).join(''):`<div class="kb-empty">Drop leads here</div>`;
    return `<div class="kb-col" data-stage="${stage.id}" ondragover="kbDragOver(event,this)" ondragleave="kbDragLeave(this)" ondrop="kbDrop(event,this,'${stage.id}')">
      <div class="kb-col-hd"><div class="kb-col-hd-top"><div style="display:flex;align-items:center;gap:6px"><div style="width:8px;height:8px;border-radius:50%;background:${stage.dot};flex-shrink:0"></div><span class="kb-col-name" style="color:${stage.color}">${stage.label}</span></div><span class="kb-col-count">${leads.length}</span></div><div class="kb-col-value">${leads.length} deal${leads.length!==1?'s':''}</div></div>
      <div class="kb-cards" id="kbCards-${stage.id}">${cards}</div></div>`;
  }).join('');
  board.querySelectorAll('.kb-card').forEach(card=>{card.addEventListener('dragstart',kbDragStart);card.addEventListener('dragend',kbDragEnd);});
}
function buildKanbanCard(lead){
  const name=((lead.first_name||'')+' '+(lead.last_name||'')).trim()||'—',company=lead.company_name||'—';
  const src=lead.utm_source?`<span class="badge gy" style="font-size:10px;padding:1px 5px">${lead.utm_source}</span>`:'';
  const stageId=defaultStage(lead);
  const statusBadge=stageId==='Won'?`<span class="kb-card-status won">WON</span>`:stageId==='Lost'?`<span class="kb-card-status lost">LOST</span>`:'';
  return `<div class="kb-card" draggable="true" data-id="${lead.id}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:7px;flex:1;min-width:0">
        <div style="width:22px;height:22px;border-radius:4px;background:rgba(124,58,237,0.12);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--acc);flex-shrink:0">${initials(company)}</div>
        <div class="kb-card-company" style="flex:1">${company}</div>
      </div>${statusBadge}<button class="kb-card-open" onclick="event.stopPropagation();openLead(${lead.id})" title="Open lead">open_in_new</button>
    </div>
    <div class="kb-card-contact">${name}</div>
    <div class="kb-card-footer">${src}${lead.preferred_date?`<div class="kb-card-date"><span class="mat sm" style="font-size:12px">event</span>${fmtDate(lead.preferred_date)}</div>`:''}</div>
  </div>`;
}
let _dragGhost=null;
function kbDragStart(e){const card=e.currentTarget;pipelineDragId=parseInt(card.dataset.id);card.classList.add('dragging');_dragGhost=card.cloneNode(true);_dragGhost.className='kb-card kb-ghost';_dragGhost.style.width=card.offsetWidth+'px';document.body.appendChild(_dragGhost);e.dataTransfer.setDragImage(_dragGhost,_dragGhost.offsetWidth/2,20);e.dataTransfer.effectAllowed='move';}
function kbDragEnd(e){e.currentTarget.classList.remove('dragging');if(_dragGhost){_dragGhost.remove();_dragGhost=null;}document.querySelectorAll('.kb-col.drag-over').forEach(c=>c.classList.remove('drag-over'));pipelineDragId=null;}
function kbDragOver(e,col){e.preventDefault();e.dataTransfer.dropEffect='move';col.classList.add('drag-over');}
function kbDragLeave(col){col.classList.remove('drag-over');}
async function kbDrop(e,col,newStage){
  
  e.preventDefault();col.classList.remove('drag-over');if(!pipelineDragId)return;
  const lead=allLeads.find(l=>l.id===pipelineDragId);if(!lead)return;
  const oldStage=defaultStage(lead);if(oldStage===newStage)return;
  lead.pipeline_stage=newStage;
  if (
    newStage === 'Won' ||
    newStage === 'Lost' ||
    newStage === 'Disqualified'
){
    lead.status = newStage === 'Disqualified'
        ? 'Lost'
        : newStage;
}
  if(
    ['Won','Lost','Disqualified'].includes(oldStage) &&
    !['Won','Lost','Disqualified'].includes(newStage)
){
    lead.status='Potential';
}
  renderPipeline();renderTable(activeFilter==='all'?allLeads:allLeads.filter(l=>l.status===activeFilter));updateDashboard();updateSidebarCounts();
  try{const payload={action:'update_pipeline_stage',id:lead.id,pipeline_stage:newStage};if (
    newStage === 'Won' ||
    newStage === 'Lost' ||
    newStage === 'Disqualified'
) {
    payload.status =
        newStage === 'Disqualified'
            ? 'Lost'
            : newStage;
} else if (
    ['Won', 'Lost', 'Disqualified'].includes(oldStage) &&
    !['Won', 'Lost', 'Disqualified'].includes(newStage)
) {
    payload.status = 'Potential';
}
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!res.ok)throw new Error(`HTTP ${res.status}`);toast(`✓ Moved to ${newStage}`,'ok');}
  catch(err){lead.pipeline_stage=oldStage;renderPipeline();toast('Failed to update stage. Check n8n webhook.','err');console.error('Pipeline stage update failed:',err);}
}
function updateMeetingsBadge(){const today=new Date().toISOString().slice(0,10),todayCount=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===today).length,el=document.getElementById('navCountMeetings');if(!el)return;if(todayCount>0){el.style.display='';el.style.background='var(--re-d)';el.style.color='var(--re)';el.textContent=todayCount;}else{el.style.display='none';}}
function mhCalEventClick(id){const lead=allLeads.find(l=>l.id===id);if(!lead)return;mhShowDrawer(lead);}

function renderMeetings(){}
function renderMeetingsHub(){
  renderCalendar();
  renderMhKpis();

  const activeTab=document.querySelector('.mh-tab.active');
  const tabId=activeTab?activeTab.id.replace('mhTab-',''):'calendar';
  renderMhTabContent(tabId);
}

function renderMhKpis(){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const weekEnd=new Date(now);weekEnd.setDate(now.getDate()+6);
  const weekStr=weekEnd.toISOString().slice(0,10);
  const hasMtg=l=>l.preferred_date;
  const today=allLeads.filter(l=>hasMtg(l)&&l.preferred_date.slice(0,10)===todayStr).length;
  const week=allLeads.filter(l=>{if(!hasMtg(l))return false;const d=l.preferred_date.slice(0,10);return d>=todayStr&&d<=weekStr;}).length;
  const upcoming=allLeads.filter(l=>hasMtg(l)&&l.preferred_date.slice(0,10)>todayStr).length;
  const completed=allLeads.filter(l=>hasMtg(l)&&l.preferred_date.slice(0,10)<todayStr).length;
  const overdue=allLeads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now&&l.status==='Potential').length;
  const total=allLeads.filter(l=>hasMtg(l)).length;
  const rate=total>0?Math.round((completed/total)*100):0;
  setEl('mhKpiToday',today);setEl('mhKpiWeek',week);setEl('mhKpiUpcoming',upcoming);
  setEl('mhKpiCompleted',completed);setEl('mhKpiOverdue',overdue);setEl('mhKpiRate',rate+'%');
}

function switchMhTab(tab){
  document.querySelectorAll('.mh-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.mh-panel').forEach(p=>p.classList.remove('active'));
  const tabEl=document.getElementById('mhTab-'+tab);if(tabEl)tabEl.classList.add('active');
  const panelEl=document.getElementById('mhPanel-'+tab);if(panelEl)panelEl.classList.add('active');
  renderMhTabContent(tab);
}

function renderMhTabContent(tab){
  if(tab==='calendar'){renderCalendar();}
  else if(tab==='upcoming'){renderMhUpcoming('all');}
  else if(tab==='notes'){renderMhNotes();renderMhFollowups();}
  else if(tab==='analytics'){renderMhAnalytics();}
  else if(tab==='recordings'){renderMhRecordings();}
}

/* ============================================================
   RECORDINGS (Fathom AI / Google Meet)
   Frontend is fully wired: connectRecordingProvider() calls the
   real n8n webhook (API.getRecordings) once a backend integration
   exists. Until then providers stay "Not Connected" honestly —
   use "Preview sample layout" to see the finished UI with mock data.
   ============================================================ */
const SAMPLE_RECORDINGS=[
  {id:'rec_1',provider:'fathom',title:'Discovery Call — Stark Industries expansion',contact:'Tony Stark',date:'2026-07-14',duration:'32:10',participants:'Tony Stark, You',
   video_url:'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
   summary:'Tony wants to expand the EMEA rollout by Q3. Budget is confirmed at $4.2M. Main concern is deployment downtime during migration — needs a written mitigation plan before signing.',
   actionItems:['Send EMEA security whitepaper','Schedule technical deep-dive with Pepper Potts','Follow up with signed mitigation plan by Friday'],
   transcript:[['00:02','Tony','We are looking to expand the EMEA rollout by Q3.'],['02:14','You','Understood — let’s walk through the current infrastructure first.'],['08:40','Tony','Our main concern is downtime during migration.'],['15:02','You','We can phase the rollout to avoid any downtime.']]},
  {id:'rec_2',provider:'googleMeet',title:'Onboarding kickoff — Culver University',contact:'Bruce Banner',date:'2026-07-12',duration:'18:45',participants:'Bruce Banner, You',
   summary:'Kickoff call to align on research data pipeline requirements. Bruce will share the dataset schema by next week.',
   actionItems:['Receive dataset schema from Bruce','Draft data-processing agreement'],
   transcript:[['00:05','Bruce','Let’s start with the data pipeline requirements.'],['06:30','You','We will need the schema to scope the integration.']]},
  {id:'rec_3',provider:'fathom',title:'Renewal check-in — VA Medical',contact:'Sam Wilson',date:'2026-07-09',duration:'11:20',participants:'Sam Wilson, You',
   summary:'Quick renewal check-in — Sam confirmed renewal for another 12 months, no changes to scope.',
   actionItems:['Send renewed contract for signature'],
   transcript:[['00:01','Sam','Happy with the service, let’s renew for another year.']]}
];

function connectRecordingProvider(key){
  const btn=document.getElementById('mhProviderBtn-'+key);
  const original=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='<span class="spin mat sm">sync</span>Connecting…';
  // In production this redirects to the provider's OAuth screen, then the
  // backend n8n workflow stores the access token and starts syncing recordings.
  fetch(API.getRecordings).then(r=>{if(!r.ok)throw new Error('not configured');return r.json();})
    .then(data=>{
      recProviders[key].connected=true;
      allRecordings=Array.isArray(data)?data:allRecordings;
      updateProviderCard(key);
      renderMhRecordings();
      toast(recProviders[key].label+' connected');
    })
    .catch(()=>{
      btn.disabled=false;btn.innerHTML=original;
      toast('Recordings webhook is not configured yet — ask an admin to add it in n8n','err');
    });
}

function updateProviderCard(key){
  const card=document.getElementById('mhProviderCard-'+key);
  const status=document.getElementById('mhProviderStatus-'+key);
  const sub=document.getElementById('mhProviderSub-'+key);
  const btn=document.getElementById('mhProviderBtn-'+key);
  const connected=recProviders[key].connected;
  card.classList.toggle('connected',connected);
  status.textContent=connected?'Connected':'Not Connected';
  status.className='mh-provider-status '+(connected?'on':'off');
  sub.textContent=(key==='fathom'?'AI meeting recorder':'Auto-capture from Google Meet')+(connected?' — syncing recordings':' — not connected');
  btn.style.display=connected?'none':'flex';
}

function toggleRecordingsPreview(){
  recPreviewMode=!recPreviewMode;
  const btn=document.getElementById('mhRecPreviewBtn');
  btn.innerHTML=recPreviewMode?'<span class="mat sm">visibility_off</span>Exit preview':'<span class="mat sm">visibility</span>Preview sample layout';
  renderMhRecordings();
}

function setRecProviderFilter(p){
  recProviderFilter=p;
  document.querySelectorAll('#mhRecProviderFilter .topt').forEach(o=>o.classList.toggle('active',o.dataset.p===p));
  renderMhRecordings();
}

function providerIcon(p){return p==='fathom'?'smart_toy':'videocam';}
function providerLabel(p){return p==='fathom'?'Fathom AI':'Google Meet';}

function renderMhRecordings(){
  const anyConnected=recProviders.fathom.connected||recProviders.googleMeet.connected;
  const toolbar=document.getElementById('mhRecToolbar');
  const archive=document.getElementById('mhRecArchive');
  const countEl=document.getElementById('mhRecCount');
  const showData=recPreviewMode||anyConnected;
  const source=recPreviewMode?SAMPLE_RECORDINGS:allRecordings;

  toolbar.style.display=showData&&source.length?'flex':'none';

  if(!showData){
    countEl.textContent='';
    archive.innerHTML=`<div class="mh-empty-feature">
      <span class="mat">video_library</span>
      <div class="mh-feature-chip">Not Connected</div>
      <div style="font-size:15px;font-weight:600;color:var(--tx)">No recording source connected yet</div>
      <div style="font-size:13px;color:var(--tx3);max-width:360px;line-height:1.7">Connect Fathom AI or Google Meet above and every call and meeting recording, transcript, and AI summary will appear here automatically. Not ready yet? Click "Preview sample layout" to see exactly how it will look.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px">
        <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:6px;font-size:12px;color:var(--tx2)"><span class="mat sm" style="color:var(--acc)">record_voice_over</span>Auto-transcription</div>
        <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:6px;font-size:12px;color:var(--tx2)"><span class="mat sm" style="color:var(--bl)">auto_awesome</span>AI Summaries</div>
        <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:6px;font-size:12px;color:var(--tx2)"><span class="mat sm" style="color:var(--gr)">search</span>Searchable Transcripts</div>
        <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--s2);border:1px solid var(--bd);border-radius:6px;font-size:12px;color:var(--tx2)"><span class="mat sm" style="color:var(--am)">task_alt</span>Action Item Extraction</div>
      </div>
    </div>`;
    return;
  }

  const q=(document.getElementById('mhRecSearch')?.value||'').toLowerCase();
  let list=source.filter(r=>recProviderFilter==='all'||r.provider===recProviderFilter);
  if(q)list=list.filter(r=>r.title.toLowerCase().includes(q)||r.contact.toLowerCase().includes(q));

  countEl.textContent=' · '+list.length+(list.length===1?' recording':' recordings');

  if(!list.length){
    archive.innerHTML=`<div class="mh-empty-feature"><span class="mat">search_off</span><div style="font-size:14px;color:var(--tx3)">No recordings match your search.</div></div>`;
    return;
  }

  archive.innerHTML=`<div class="mh-rec-grid">${list.map(r=>`
    <div class="mh-rec-card" onclick="openRecording('${r.id}')">
      <div class="mh-rec-thumb">
        <span class="mat">play_circle</span>
        <span class="mh-rec-provider-tag"><span class="mat sm">${providerIcon(r.provider)}</span>${providerLabel(r.provider)}</span>
        <span class="mh-rec-duration">${r.duration}</span>
        ${recPreviewMode?'<span class="mh-sample-badge">SAMPLE</span>':''}
      </div>
      <div class="mh-rec-body">
        <div class="mh-rec-title">${r.title}</div>
        <div class="mh-rec-meta"><span class="mat sm" style="font-size:13px">person</span>${r.contact} · ${r.date}</div>
        <div class="mh-rec-tags">
          <span class="mh-rec-tag tr"><span class="mat sm" style="font-size:11px">subtitles</span>Transcript</span>
          <span class="mh-rec-tag ai"><span class="mat sm" style="font-size:11px">auto_awesome</span>AI Summary</span>
          <span class="mh-rec-tag ac"><span class="mat sm" style="font-size:11px">task_alt</span>${r.actionItems.length}</span>
        </div>
      </div>
    </div>`).join('')}</div>`;
}

function openRecording(id){
  const source=recPreviewMode?SAMPLE_RECORDINGS:allRecordings;
  const r=source.find(x=>String(x.id)===String(id));if(!r)return;
  document.getElementById('recTitle').textContent=r.title||'Untitled Recording';
  document.getElementById('recSub').textContent=(r.contact||'—')+' · '+(r.date||'—');
  document.getElementById('recTagRow').innerHTML=`<span class="badge" style="background:var(--acc-d);color:var(--acc)">${providerLabel(r.provider)}</span>${recPreviewMode?'<span class="badge" style="background:var(--am-d);color:var(--am)">SAMPLE</span>':''}`;
  document.getElementById('recDate').textContent=r.date||'—';
  document.getElementById('recDuration').textContent=r.duration||'—';
  document.getElementById('recParticipants').textContent=r.participants||'—';
  document.getElementById('recProvider').textContent=providerLabel(r.provider);
 const summaryEl = document.getElementById('recSummary');
const s = r.summaryData;

if (s) {
  let html = '';

  if (s.meetingPurpose) {
    html += `
      <div class="rec-summary-section">
        <div class="rec-summary-title">Meeting Purpose</div>
        <div class="rec-summary-text">${escHtml(s.meetingPurpose)}</div>
      </div>
    `;
  }

  if (s.keyTakeaways?.length) {
    html += `
      <div class="rec-summary-section">
        <div class="rec-summary-title">Key Takeaways</div>
        <ul class="rec-summary-list">
          ${s.keyTakeaways.map(x => `<li>${escHtml(x)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (s.topics?.length) {
    html += `
      <div class="rec-summary-section">
        <div class="rec-summary-title">Topics</div>
        <div class="rec-summary-topics">
          ${s.topics.map(x => `
            <div class="rec-summary-topic">
              ${x.label ? `<strong>${escHtml(x.label)}:</strong> ` : ''}
              ${escHtml(x.text)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  if (s.nextSteps?.length) {
    html += `
      <div class="rec-summary-section">
        <div class="rec-summary-title">Next Steps</div>
        <ul class="rec-summary-list">
          ${s.nextSteps.map(x => `<li>${escHtml(x)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  summaryEl.innerHTML = html || 'No summary available.';
} else {
  summaryEl.textContent = r.summary || 'No summary available.';
}
  
  document.getElementById('recActionItems').innerHTML=(r.actionItems&&r.actionItems.length)?r.actionItems.map(a=>`
    <div class="lp-row"><div class="lp-ri"><span class="mat">check_box_outline_blank</span></div><div class="lp-rv" style="font-weight:400">${a}</div></div>`).join(''):`<div style="padding:10px 13px;font-size:12px;color:var(--tx3)">No action items recorded.</div>`;
  document.getElementById('recTranscript').innerHTML=(r.transcript&&r.transcript.length)?r.transcript.map(([t,who,txt])=>`
    <div class="rec-tl-line"><div class="rec-tl-time">${t}</div><div class="rec-tl-txt"><b>${who}:</b> ${txt}</div></div>`).join(''):`<div style="padding:10px 13px;font-size:12px;color:var(--tx3)">No transcript available.</div>`;
  const player=document.getElementById('recVideoPlayer');
  const placeholder=document.getElementById('recVideoPlaceholderIcon');
  if(r.video_url){
    player.src=r.video_url;
    player.style.display='block';
    placeholder.style.display='none';
  }else{
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.style.display='none';
    placeholder.style.display='block';
  }
  document.getElementById('recPanel').classList.add('lp-open');
  document.getElementById('recOverlay').classList.add('show');
}

function closeRecPanel(){
  document.getElementById('recPanel').classList.remove('lp-open');
  document.getElementById('recOverlay').classList.remove('show');
  const player=document.getElementById('recVideoPlayer');
  if(player){player.pause();}
}


let mhUpcomingMode='all';
function filterUpcoming(mode,el){
  mhUpcomingMode=mode;
  document.querySelectorAll('#mhUpcomingFilter .topt').forEach(t=>t.classList.remove('active'));
  if(el)el.classList.add('active');
  renderMhUpcoming(mode);
}
function renderMhUpcoming(mode){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const weekEnd=new Date(now);weekEnd.setDate(now.getDate()+6);
  const weekStr=weekEnd.toISOString().slice(0,10);
  let leads=allLeads.filter(l=>l.preferred_date);
  if(mode==='today')leads=leads.filter(l=>l.preferred_date.slice(0,10)===todayStr);
  else if(mode==='week')leads=leads.filter(l=>{const d=l.preferred_date.slice(0,10);return d>=todayStr&&d<=weekStr;});
  else if(mode==='future')leads=leads.filter(l=>l.preferred_date.slice(0,10)>todayStr);
  leads=leads.sort((a,b)=>a.preferred_date.localeCompare(b.preferred_date));
  setEl('mhUpcomingCount',leads.length+' meeting'+(leads.length!==1?'s':''));
  const el=document.getElementById('mhUpcomingList');if(!el)return;
  if(!leads.length){el.innerHTML=`<div class="empty-state"><span class="mat">event_busy</span><p>No meetings in this range.</p></div>`;return;}
  el.innerHTML=leads.map(l=>{
    const nm=((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';
    const ds=l.preferred_date.slice(0,10);
    const isToday=ds===todayStr;
    const isPast=ds<todayStr;
    const d=new Date(ds+'T12:00:00');
    const day=d.getDate();
    const mon=d.toLocaleString('default',{month:'short'}).toUpperCase();
    const wkd=d.toLocaleString('default',{weekday:'short'}).toUpperCase();
    const cardClass=isToday?'today':isPast?'overdue':'';
    const hasMeetUrl=l.notes&&l.notes.includes('meet.google.com');
    return `<div class="mh-meeting-card ${cardClass}" onclick="openLead(${l.id})">
      <div class="mh-meeting-time"><div class="date">${wkd}</div><div class="day">${day}</div><div class="month">${mon}</div></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div class="mh-meeting-avatar">${initials(l.company_name||nm)}</div>
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--tx)">${l.company_name||'—'}</div>
            <div style="font-size:12px;color:var(--tx3)">${nm}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:6px;flex-wrap:wrap">
          ${l.preferred_time?`<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--tx2)"><span class="mat sm" style="font-size:14px">schedule</span>${fmtTime(l.preferred_time)}</span>`:''}
          <span class="badge st-${l.status||'Potential'}">${l.status||'Potential'}</span>
          ${isToday?`<span style="font-size:10px;font-weight:700;background:rgba(124,58,237,0.15);color:var(--acc);padding:2px 7px;border-radius:3px;letter-spacing:0.06em">TODAY</span>`:''}
          ${isPast&&!isToday?`<span style="font-size:10px;font-weight:700;background:var(--re-d);color:var(--re);padding:2px 7px;border-radius:3px;letter-spacing:0.06em">PAST</span>`:''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
        ${isToday?`<button class="abtn pri" style="font-size:12px;padding:5px 12px" onclick="event.stopPropagation();mhJoinFromLead(${l.id})"><span class="mat sm">video_call</span>Join</button>`:''}
        <button class="abtn" style="font-size:12px;padding:5px 10px" onclick="event.stopPropagation();openLead(${l.id})"><span class="mat sm">open_in_new</span>Open</button>
      </div>
    </div>`;
  }).join('');
}


function renderMhNotes(){
  const leads=allLeads.filter(l=>l.notes&&l.notes.trim()).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  setEl('mhNotesCount',leads.length+' note'+(leads.length!==1?'s':''));
  const el=document.getElementById('mhNotesList');if(!el)return;
  if(!leads.length){el.innerHTML=`<div class="empty-state"><span class="mat">sticky_note_2</span><p>No notes added to leads yet.</p><button class="abtn pri" onclick="navigate('opportunities')">View Leads</button></div>`;return;}
  el.innerHTML=leads.map(l=>{
    const nm=((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';
    return `<div class="mh-note-card" style="cursor:pointer" onclick="openLead(${l.id})">
      <div class="mh-note-hd">
        <div style="display:flex;align-items:center;gap:9px">
          <div class="mh-meeting-avatar" style="width:32px;height:32px;font-size:12px">${initials(l.company_name||nm)}</div>
          <div><div style="font-size:14px;font-weight:600;color:var(--tx)">${l.company_name||nm}</div>
          <div style="font-size:11px;color:var(--tx3)">${nm} · ${fmtDate(l.preferred_date||l.created_at)}</div></div>
        </div>
        <span class="badge st-${l.status||'Potential'}">${l.status||'Potential'}</span>
      </div>
      <div style="font-size:13px;color:var(--tx2);line-height:1.65;padding:8px 10px;background:var(--bg);border-radius:5px;border:1px solid var(--bd)">${escHtml(l.notes).slice(0,240)}${l.notes.length>240?'…':''}</div>
    </div>`;
  }).join('');
}
function renderMhFollowups(){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const overdueLeads=allLeads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now&&l.status==='Potential');
  const el=document.getElementById('mhOverdueList');
  if(el){
    if(!overdueLeads.length){el.innerHTML=`<div style="text-align:center;padding:14px;font-size:12px;color:var(--tx3)"><span class="mat sm" style="display:block;margin-bottom:5px;opacity:0.4">check_circle</span>No overdue follow-ups</div>`;}
    else{el.innerHTML=overdueLeads.slice(0,5).map(l=>`<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer" onclick="openLead(${l.id})">
      <div class="mh-meeting-avatar" style="width:28px;height:28px;font-size:11px;background:var(--re-d);color:var(--re)">${initials(l.company_name||'?')}</div>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.company_name||'—'}</div>
      <div style="font-size:11px;color:var(--re)">${fmtDate(l.next_followup_at)}</div></div>
      <span class="mat sm" style="color:var(--tx3);font-size:15px">arrow_forward_ios</span>
    </div>`).join('');}
  }
  const in7=new Date(now);in7.setDate(now.getDate()+7);
  const upcoming=allLeads.filter(l=>{if(!l.next_followup_at||l.status!=='Potential')return false;const d=new Date(l.next_followup_at);return d>=now&&d<=in7;});
  const el2=document.getElementById('mhFollowupList');
  if(el2){
    if(!upcoming.length){el2.innerHTML=`<div style="text-align:center;padding:14px;font-size:12px;color:var(--tx3)"><span class="mat sm" style="display:block;margin-bottom:5px;opacity:0.4">alarm</span>No follow-ups in next 7 days</div>`;}
    else{el2.innerHTML=upcoming.slice(0,5).map(l=>`<div style="display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer" onclick="openLead(${l.id})">
      <div class="mh-meeting-avatar" style="width:28px;height:28px;font-size:11px;background:var(--am-d);color:var(--am)">${initials(l.company_name||'?')}</div>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.company_name||'—'}</div>
      <div style="font-size:11px;color:var(--am)">${fmtDate(l.next_followup_at)}</div></div>
      <span class="mat sm" style="color:var(--tx3);font-size:15px">arrow_forward_ios</span>
    </div>`).join('');}
  }
}
function escHtml(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}


function renderMhAnalytics(){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);

  const monthData=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');const lbl=d.toLocaleString('default',{month:'short'});const cnt=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,7)===key).length;monthData.push({lbl,cnt});}
  const maxV=Math.max(...monthData.map(m=>m.cnt),1);
  const chartEl=document.getElementById('mhAnalyticsChart'),lblEl=document.getElementById('mhAnalyticsLabels');
  if(chartEl)chartEl.innerHTML=monthData.map((m,i)=>{const h=Math.max(4,Math.round((m.cnt/maxV)*84));const isNow=i===5;return `<div style="flex:1;background:${isNow?'var(--pri-c)':'rgba(124,58,237,0.35)'};border-radius:3px 3px 0 0;height:${h}px;transition:height .3s" title="${m.lbl}: ${m.cnt} meetings"></div>`;}).join('');
  if(lblEl)lblEl.innerHTML=monthData.map((m,i)=>`<div style="flex:1;text-align:center;font-size:10px;font-weight:${i===5?700:500};color:${i===5?'var(--acc)':'var(--tx3)'}">${m.lbl}</div>`).join('');

  const bkEl=document.getElementById('mhAnalyticsBreakdown');
  if(bkEl){
    const total=allLeads.filter(l=>l.preferred_date).length||1;
    const past=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)<todayStr).length;
    const future=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)>todayStr).length;
    const today=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr).length;
    bkEl.innerHTML=[{lbl:'Past Meetings',val:past,color:'var(--gr)'},{lbl:'Today',val:today,color:'var(--acc)'},{lbl:'Upcoming',val:future,color:'var(--bl)'}].map(r=>`<div class="src-row"><div class="src-row-hd"><span class="src-row-name">${r.lbl}</span><span style="font-weight:700;color:${r.color}">${r.val}</span></div><div class="src-bar-track"><div class="src-bar-fill" style="width:${Math.round((r.val/total)*100)}%;background:${r.color}"></div></div></div>`).join('');
  }

  const tbody=document.getElementById('mhAnalyticsTable');
  if(tbody){
    const rows=allLeads.filter(l=>l.preferred_date).sort((a,b)=>b.preferred_date.localeCompare(a.preferred_date)).slice(0,10);
    if(!rows.length){tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tx3)">No meetings scheduled</td></tr>`;return;}
    tbody.innerHTML=rows.map(l=>{const nm=((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';return `<tr onclick="openLead(${l.id})" style="cursor:pointer">
      <td><div style="display:flex;align-items:center;gap:8px"><div class="mh-meeting-avatar" style="width:24px;height:24px;border-radius:5px;font-size:10px">${initials(l.company_name||nm)}</div><span style="font-weight:600">${l.company_name||'—'}</span></div></td>
      <td style="font-size:13px;color:var(--tx2)">${nm}</td>
      <td><span class="badge st-${l.status||'Potential'}">${l.status||'Potential'}</span></td>
      <td style="font-size:13px">${fmtDate(l.preferred_date)}</td>
      <td style="font-size:13px;color:var(--tx2)">${fmtTime(l.preferred_time)}</td>
      <td><button class="tbb" style="width:26px;height:26px" onclick="event.stopPropagation();openLead(${l.id})"><span class="mat sm">open_in_new</span></button></td>
    </tr>`;}).join('');
  }
}


let mhDrawerLeadId=null;
function mhShowDrawer(lead){
  mhDrawerLeadId=lead.id;
  const nm=((lead.first_name||'')+' '+(lead.last_name||'')).trim()||'—';
  const sc=scClass(lead.status);
  const hasUrl=lead.notes&&lead.notes.match(/meet\.google\.com\/[^\s]+/);
  const meetUrl=hasUrl?hasUrl[0]:null;
  document.getElementById('mhDrawerContent').innerHTML=`
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div class="mh-meeting-avatar">${initials(lead.company_name||nm)}</div>
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--tx)">${lead.company_name||'—'}</div>
        <div style="font-size:12px;color:var(--tx3)">${nm}</div>
      </div>
      <span class="badge ${sc}" style="margin-left:auto">${lead.status||'Potential'}</span>
    </div>`;
  const body=document.getElementById('mhDrawerBody');
  const footer=document.getElementById('mhDrawerFooter');
  if(body){
    body.style.display='flex';
    body.innerHTML=`
      <div>
        <div class="stitle" style="margin-bottom:8px">Scheduling</div>
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg);border-radius:6px;border:1px solid var(--bd)">
          <span class="mat sm" style="color:var(--acc)">event</span>
          <span style="font-size:13px;font-weight:600;color:var(--tx)">${fmtDate(lead.preferred_date)}</span>
          ${lead.preferred_time?`<span style="font-size:13px;color:var(--tx2)">· ${fmtTime(lead.preferred_time)}</span>`:''}
        </div>
      </div>
      ${meetUrl?`<div>
        <div class="stitle" style="margin-bottom:8px">Google Meet</div>
        <div class="mh-meet-url" onclick="navigator.clipboard&&navigator.clipboard.writeText('https://${meetUrl}').then(()=>toast('URL copied','ok'))">
          <span class="mat sm">video_chat</span>
          <span style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">https://${meetUrl}</span>
          <span class="mat sm" style="color:var(--tx3)">content_copy</span>
        </div>
      </div>`:`<div style="padding:10px;background:var(--bg);border:1px dashed var(--bd);border-radius:7px;text-align:center;font-size:12px;color:var(--tx3)">
        <span class="mat sm" style="display:block;margin-bottom:5px;opacity:0.4">video_chat</span>No Meet URL — add one in lead notes (meet.google.com/…)
      </div>`}
      ${lead.notes?`<div>
        <div class="stitle" style="margin-bottom:8px">Pre-Meeting Notes</div>
        <div style="padding:10px;background:var(--bg);border:1px solid var(--bd);border-radius:7px;font-size:13px;color:var(--tx2);line-height:1.65;font-style:italic">${escHtml(lead.notes).slice(0,300)}</div>
      </div>`:''}
      <div>
        <div class="stitle" style="margin-bottom:8px">Contact</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${lead.email?`<a href="mailto:${lead.email}" style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--bl);text-decoration:none" onclick="event.stopPropagation()"><span class="mat sm">mail</span>${lead.email}</a>`:''}
          ${lead.phone?`<a href="tel:${lead.phone}" style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--bl);text-decoration:none" onclick="event.stopPropagation()"><span class="mat sm">call</span>${lead.phone}</a>`:''}
          ${!lead.email&&!lead.phone?`<span style="font-size:12px;color:var(--tx3)">No contact info</span>`:''}
        </div>
      </div>`;
  }
  if(footer){
    footer.style.display='flex';
    const joinBtn=document.getElementById('mhJoinBtn');
    if(joinBtn){joinBtn.disabled=!meetUrl;joinBtn.title=meetUrl?'Open in Google Meet':'No Meet URL found in notes';}
  }
}
function clearMhDrawer(){
  mhDrawerLeadId=null;
  document.getElementById('mhDrawerContent').innerHTML=`<div style="text-align:center;padding:28px 16px;color:var(--tx3)"><span class="mat" style="font-size:33px;display:block;margin-bottom:10px;opacity:0.3">touch_app</span><p style="font-size:13px">Click a meeting on the calendar to see details</p></div>`;
  const body=document.getElementById('mhDrawerBody'),footer=document.getElementById('mhDrawerFooter');
  if(body)body.style.display='none';if(footer)footer.style.display='none';
}
function mhJoinMeeting(){
  if(!mhDrawerLeadId)return;
  const lead=allLeads.find(l=>l.id===mhDrawerLeadId);if(!lead)return;
  const hasUrl=lead.notes&&lead.notes.match(/meet\.google\.com\/[^\s]+/);
  if(hasUrl)window.open('https://'+hasUrl[0],'_blank');
}
function mhJoinFromLead(id){
  const lead=allLeads.find(l=>l.id===id);if(!lead)return;
  const hasUrl=lead.notes&&lead.notes.match(/meet\.google\.com\/[^\s]+/);
  if(hasUrl)window.open('https://'+hasUrl[0],'_blank');else toast('No Meet URL in this lead\'s notes.','err');
}
function mhOpenLead(){if(mhDrawerLeadId)openLead(mhDrawerLeadId);}
function mhEditLead(){if(mhDrawerLeadId){const l=allLeads.find(x=>x.id===mhDrawerLeadId);if(l){currentLead=l;lpEdit();}}}
function switchCalView(v,el){document.querySelectorAll('.mh-cal-view-btn').forEach(b=>b.classList.remove('active'));if(el)el.classList.add('active');}


function openScheduleMeetingModal(){
  const sel=document.getElementById('mhSchLead');
  if(sel){sel.innerHTML='<option value="">— choose a lead —</option>'+allLeads.filter(l=>l.status==='Potential').sort((a,b)=>(a.company_name||'').localeCompare(b.company_name||'')).map(l=>`<option value="${l.id}">${l.company_name||((l.first_name||'')+' '+(l.last_name||'')).trim()||'Lead #'+l.id}</option>`).join('');}
  document.getElementById('mhScheduleModal').classList.add('open');
}
function closeMhModal(){document.getElementById('mhScheduleModal').classList.remove('open');}

function openAddTeamMemberModal(){
  document.getElementById('tmFullName').value='';
  document.getElementById('tmEmail').value='';
  document.getElementById('tmPassword').value='';
  document.getElementById('tmRole').selectedIndex=0;
  document.getElementById('addTeamMemberModal').classList.add('open');
}
function closeAddTeamMemberModal(){document.getElementById('addTeamMemberModal').classList.remove('open');}

async function submitAddTeamMember(){
  const full_name=document.getElementById('tmFullName').value.trim();
  const email=document.getElementById('tmEmail').value.trim();
  const password=document.getElementById('tmPassword').value;
  const role=document.getElementById('tmRole').value;
  if(!full_name||!email||!password){toast('Fill in name, email and a password','err');return;}
  if(password.length<8){toast('Password needs at least 8 characters','err');return;}

  const btn=document.getElementById('tmSubmitBtn');
  const original=btn.innerHTML;
  btn.disabled=true;btn.innerHTML='<span class="spin mat sm">sync</span>Creating…';
  try{
    const res=await fetch(API.createTeamMember,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name,email,password,role})});
    let data={};try{data=await res.json();}catch(e){}
    if(res.status===409){toast(data.message||'That email is already registered','err');return;}
    if(!res.ok){toast(data.message||`Something went wrong (HTTP ${res.status})`,'err');return;}
    toast('✓ '+(data.message||'Team member created')+' — they’ll get a password-setup email','ok');
    closeAddTeamMemberModal();
  }catch(e){
    toast('Could not reach the server — check your connection','err');
  }finally{
    btn.disabled=false;btn.innerHTML=original;
  }
}
async function saveMhSchedule(){
  const leadId=document.getElementById('mhSchLead').value;
  const date=document.getElementById('mhSchDate').value;
  const time=document.getElementById('mhSchTime').value;
  const meetUrl=document.getElementById('mhSchMeetUrl').value.trim();
  const notes=document.getElementById('mhSchNotes').value.trim();
  if(!leadId){toast('Please select a lead.','err');return;}
  if(!date){toast('Please select a date.','err');return;}
  const lead=allLeads.find(l=>l.id==leadId);if(!lead){toast('Lead not found.','err');return;}
  const newNotes=[notes,meetUrl?'Google Meet: '+meetUrl:''].filter(Boolean).join('\n\n').trim()||lead.notes||'';
  const payload={action:'update_lead',id:parseInt(leadId),preferred_date:date,preferred_time:time||null,notes:newNotes||null};
  try{const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const idx=allLeads.findIndex(l=>l.id==leadId);if(idx>-1)allLeads[idx]={...allLeads[idx],...payload};
    closeMhModal();toast('✓ Meeting scheduled','ok');
    renderMhKpis();renderCalendar();renderMhUpcoming(mhUpcomingMode);updateDashboard();}
  catch(e){toast('Failed to save. Check n8n webhook.','err');}
}

/* ============================================================
   REPORTS
   Reporting/export/comparison layer. Does not fetch or store
   anything of its own — it reads the same allLeads array already
   loaded for Leads/Pipeline/Analytics, and reuses the same owner
   map (closersMap) and pipeline stage list (PIPELINE_STAGES) so
   KPI definitions never drift from what Analytics/Funnel already
   show. CSV export is real; PDF export and report persistence
   (Recent Reports / Scheduled Reports) are intentionally left as
   "coming soon" until a backend exists for them.
   ============================================================ */
let rptState={type:'sales_summary',preset:'30',dateFrom:'',dateTo:'',owner:'',source:''};

function rptDateBounds(){
  if(rptState.preset==='custom'){
    return{from:rptState.dateFrom||null,to:rptState.dateTo||null};
  }
  const days=parseInt(rptState.preset,10);
  if(!days)return{from:null,to:null};
  const to=new Date();
  const from=new Date();from.setDate(from.getDate()-days);
  return{from:from.toISOString().slice(0,10),to:to.toISOString().slice(0,10)};
}
function rptRangeLabel(){
  const{from,to}=rptDateBounds();
  if(!from&&!to)return'All time';
  if(from&&to)return fmtDate(from)+' – '+fmtDate(to);
  return'Custom range';
}
function rptScopeLabel(){
  let s='';
  if(rptState.owner)s+=' · Owner: '+(closersMap[rptState.owner]||rptState.owner);
  if(rptState.source)s+=' · Source: '+rptState.source;
  return s;
}
function rptFilteredLeads(){
  const{from,to}=rptDateBounds();
  let list=allLeads;
  if(from)list=list.filter(l=>l.created_at&&l.created_at.slice(0,10)>=from);
  if(to)list=list.filter(l=>l.created_at&&l.created_at.slice(0,10)<=to);
  if(rptState.owner)list=list.filter(l=>(l.owner_id||l.account_manager||'Unassigned')===rptState.owner);
  if(rptState.source)list=list.filter(l=>(l.utm_source||l.referral||'Direct')===rptState.source);
  return list;
}
async function rptPopulateFilterOptions(){
  await ensureClosersLoaded();
  const ownerSel=document.getElementById('rptOwner');
  if(ownerSel){
    const owners=[...new Set(allLeads.map(l=>l.owner_id||l.account_manager||'Unassigned').filter(Boolean))]
      .sort((a,b)=>(closersMap[a]||a).localeCompare(closersMap[b]||b));
    const cur=rptState.owner;
    ownerSel.innerHTML='<option value="">All Owners</option>'+owners.map(o=>`<option value="${o}">${escapeHtml(closersMap[o]||o)}</option>`).join('');
    ownerSel.value=cur;
  }
  const srcSel=document.getElementById('rptSource');
  if(srcSel){
    const sources=[...new Set(allLeads.map(l=>l.utm_source||l.referral||'Direct'))].sort();
    const cur=rptState.source;
    srcSel.innerHTML='<option value="">All Sources</option>'+sources.map(s=>`<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    srcSel.value=cur;
  }
}
function rptReadAdSpend(days){
  try{return parseFloat(localStorage.getItem('nxtup-adspend-'+days))||0;}catch(e){return 0;}
}
function rptEmptyState(icon,msg){
  return`<div class="empty-state" style="padding:32px 20px"><span class="mat">${icon}</span><p>${msg}</p></div>`;
}

/* --- data (shared between preview render + CSV export, one definition per KPI) --- */
function rptSalesSummaryData(){
  const leads=rptFilteredLeads();
  const total=leads.length;
  const active=leads.filter(l=>l.status==='Potential').length;
  const won=leads.filter(l=>l.status==='Won').length;
  const lost=leads.filter(l=>l.status==='Lost').length;
  const closed=won+lost;
  const convRate=closed>0?Math.round((won/closed)*100):null;
  const wonWithValue=leads.filter(l=>l.status==='Won'&&l.deal_value);
  const revenue=wonWithValue.reduce((s,l)=>s+parseFloat(l.deal_value||0),0);
  const avgDeal=wonWithValue.length?revenue/wonWithValue.length:null;
  return{
    kpis:[
      {label:'Leads Created',value:total},
      {label:'Won',value:won},
      {label:'Lost',value:lost},
      {label:'Conversion Rate',value:convRate!==null?convRate+'%':'—'},
      {label:'Revenue Won',value:revenue>0?'$'+revenue.toFixed(2):'—'},
      {label:'Avg Deal Size',value:avgDeal!==null?'$'+avgDeal.toFixed(2):'—'},
    ],
    table:{
      headers:['Status','Count','% of Total'],
      rows:[
        ['Potential',active,total>0?Math.round((active/total)*100)+'%':'0%'],
        ['Won',won,total>0?Math.round((won/total)*100)+'%':'0%'],
        ['Lost',lost,total>0?Math.round((lost/total)*100)+'%':'0%'],
      ]
    }
  };
}
function rptOwnerPerformanceData(){
  const leads=rptFilteredLeads();
  const map={};
  leads.forEach(l=>{
    const owner=l.owner_id||l.account_manager||'Unassigned';
    if(!map[owner])map[owner]={total:0,won:0,lost:0,revenue:0};
    map[owner].total++;
    if(l.status==='Won'){map[owner].won++;map[owner].revenue+=parseFloat(l.deal_value||0);}
    if(l.status==='Lost')map[owner].lost++;
  });
  const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total).map(([owner,d])=>{
    const closed=d.won+d.lost;
    const wr=closed>0?Math.round((d.won/closed)*100):null;
    return{owner:closersMap[owner]||owner,total:d.total,won:d.won,lost:d.lost,revenue:d.revenue,wr};
  });
  return{rows};
}
function rptPipelineSnapshotData(){
  const leads=rptFilteredLeads();
  const total=leads.length;
  const map={};
  PIPELINE_STAGES.forEach(s=>map[s.id]={count:0,value:0});
  leads.forEach(l=>{
    const stage=l.pipeline_stage||'New';
    if(!map[stage])map[stage]={count:0,value:0};
    map[stage].count++;
    map[stage].value+=parseFloat(l.deal_value||0);
  });
  const rows=PIPELINE_STAGES.map(s=>({
    stage:s.label,
    count:map[s.id].count,
    value:map[s.id].value,
    pct:total>0?Math.round((map[s.id].count/total)*100):0
  }));
  return{total,rows};
}
function rptSourcePerformanceData(){
  const leads=rptFilteredLeads();
  const map={};
  leads.forEach(l=>{
    const src=l.utm_source||l.referral||'Direct';
    if(!map[src])map[src]={total:0,won:0,revenue:0};
    map[src].total++;
    if(l.status==='Won'){map[src].won++;map[src].revenue+=parseFloat(l.deal_value||0);}
  });
  const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total).map(([src,d])=>({
    source:src,total:d.total,won:d.won,
    convRate:d.total>0?Math.round((d.won/d.total)*100):0,
    revenue:d.revenue
  }));
  return{rows};
}

/* --- render --- */
function rptRenderSalesSummary(){
  const d=rptSalesSummaryData();
  setEl('rptPreviewTitle','Sales Summary');
  const sub=document.getElementById('rptPreviewSub');if(sub)sub.textContent='Leads created '+rptRangeLabel()+rptScopeLabel();
  const kpiHtml=`<div class="rpt-kpi-row">`+d.kpis.map(k=>`<div class="csm" style="padding:12px 14px"><div class="kpi-sub">${k.label}</div><div class="kpi-val-lg">${k.value}</div></div>`).join('')+`</div>`;
  const tableHtml=`<div style="overflow-x:auto"><table class="dt"><thead><tr><th>${d.table.headers[0]}</th><th>${d.table.headers[1]}</th><th>${d.table.headers[2]}</th></tr></thead><tbody>`+
    d.table.rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')+`</tbody></table></div>`;
  const body=document.getElementById('rptPreviewBody');if(body)body.innerHTML=kpiHtml+tableHtml;
}
function rptRenderOwnerPerformance(){
  const{rows}=rptOwnerPerformanceData();
  setEl('rptPreviewTitle','Owner Performance');
  const sub=document.getElementById('rptPreviewSub');if(sub)sub.textContent='Leads created '+rptRangeLabel()+rptScopeLabel();
  const body=document.getElementById('rptPreviewBody');if(!body)return;
  if(!rows.length){body.innerHTML=rptEmptyState('person_off','No leads match this filter combination.');return;}
  body.innerHTML=`<div style="overflow-x:auto"><table class="dt"><thead><tr><th>Owner</th><th>Total Leads</th><th>Won</th><th>Lost</th><th>Win Rate</th><th>Revenue Won</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td style="font-weight:600">${escapeHtml(r.owner)}</td><td>${r.total}</td><td style="color:var(--gr)">${r.won}</td><td style="color:var(--re)">${r.lost}</td><td>${r.wr!==null?r.wr+'%':'—'}</td><td>${r.revenue>0?'$'+r.revenue.toFixed(2):'—'}</td></tr>`).join('')+
    `</tbody></table></div>`;
}
function rptRenderPipelineSnapshot(){
  const{total,rows}=rptPipelineSnapshotData();
  setEl('rptPreviewTitle','Pipeline Snapshot');
  const sub=document.getElementById('rptPreviewSub');if(sub)sub.textContent='Current stage of leads created '+rptRangeLabel()+rptScopeLabel();
  const body=document.getElementById('rptPreviewBody');if(!body)return;
  if(!total){body.innerHTML=rptEmptyState('view_kanban','No leads match this filter combination.');return;}
  body.innerHTML=`<div style="overflow-x:auto"><table class="dt"><thead><tr><th>Stage</th><th>Leads</th><th>% of Filtered Pipeline</th><th>Stage Value</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td style="font-weight:600">${r.stage}</td><td>${r.count}</td><td>${r.pct}%</td><td>${r.value>0?'$'+r.value.toFixed(2):'—'}</td></tr>`).join('')+
    `</tbody></table></div>`;
}
function rptRenderSourcePerformance(){
  const{rows}=rptSourcePerformanceData();
  setEl('rptPreviewTitle','Source / Channel Performance');
  const sub=document.getElementById('rptPreviewSub');if(sub)sub.textContent='Leads created '+rptRangeLabel()+rptScopeLabel();
  const body=document.getElementById('rptPreviewBody');if(!body)return;
  let spendNote;
  if(['7','30','90','0'].includes(String(rptState.preset))){
    const spend=rptReadAdSpend(rptState.preset);
    spendNote=spend>0
      ?`<div style="font-size:12px;color:var(--tx3);margin-bottom:14px;display:flex;align-items:flex-start;gap:6px"><span class="mat sm" style="font-size:15px;margin-top:1px">info</span><span>Total ad spend for this period: <strong style="color:var(--tx2)">$${spend.toFixed(2)}</strong> — spend isn't tracked per source yet, so ROI/CPA can't be broken down by channel below.</span></div>`
      :`<div style="font-size:12px;color:var(--tx3);margin-bottom:14px;display:flex;align-items:flex-start;gap:6px"><span class="mat sm" style="font-size:15px;margin-top:1px">info</span><span>No ad spend on record for this period. Enter it on the Funnel Metrics page for cost context here.</span></div>`;
  }else{
    spendNote=`<div style="font-size:12px;color:var(--tx3);margin-bottom:14px;display:flex;align-items:flex-start;gap:6px"><span class="mat sm" style="font-size:15px;margin-top:1px">info</span><span>Per-source cost/ROI data requires ad spend tracked by channel, which isn't available yet.</span></div>`;
  }
  if(!rows.length){body.innerHTML=spendNote+rptEmptyState('travel_explore','No leads match this filter combination.');return;}
  body.innerHTML=spendNote+`<div style="overflow-x:auto"><table class="dt"><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Won %</th><th>Revenue Won</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td style="font-weight:600">${escapeHtml(r.source)}</td><td>${r.total}</td><td style="color:var(--gr)">${r.won}</td><td>${r.convRate}%</td><td>${r.revenue>0?'$'+r.revenue.toFixed(2):'—'}</td></tr>`).join('')+
    `</tbody></table></div>`;
}
function rptRenderActivityReport(){
  setEl('rptPreviewTitle','Activity Report');
  const sub=document.getElementById('rptPreviewSub');if(sub)sub.textContent='Calls, emails, SMS and notes logged across the team';
  const body=document.getElementById('rptPreviewBody');if(!body)return;
  body.innerHTML=`<div class="empty-state" style="padding:36px 20px">
    <span class="mat">forum</span>
    <p>Activity data is currently only available per lead, inside the Communication Hub. A team-wide activity report needs a bulk activity endpoint that isn't connected yet.</p>
    <button class="abtn pri" onclick="navigate('communication')"><span class="mat sm">forum</span>Open Communication Hub</button>
  </div>`;
}
function rptUpdateFilterNote(){
  const note=document.getElementById('rptFilterNote');if(!note)return;
  if(rptState.type==='activity_report'){note.textContent='Filters above don\'t apply yet — activity is tracked per lead only.';return;}
  const n=rptFilteredLeads().length;
  note.textContent=`${n} lead${n!==1?'s':''} match the current filters.`;
}
function rptRenderPreview(){
  const body=document.getElementById('rptPreviewBody');
  if(!body)return;
  switch(rptState.type){
    case'sales_summary':rptRenderSalesSummary();break;
    case'owner_performance':rptRenderOwnerPerformance();break;
    case'pipeline_snapshot':rptRenderPipelineSnapshot();break;
    case'source_performance':rptRenderSourcePerformance();break;
    case'activity_report':rptRenderActivityReport();break;
    default:rptRenderSalesSummary();
  }
  rptUpdateFilterNote();
}

/* --- builder bar interactions --- */
function rptOnTypeChange(){
  const sel=document.getElementById('rptType');if(!sel)return;
  rptState.type=sel.value;
  rptRenderPreview();
}
function rptOnPresetChange(){
  const sel=document.getElementById('rptDatePreset');if(!sel)return;
  const customWrap=document.getElementById('rptCustomDates');
  if(sel.value==='custom'){
    if(customWrap)customWrap.style.display='flex';
  }else{
    if(customWrap)customWrap.style.display='none';
    rptState.preset=sel.value;
    rptRenderPreview();
  }
}
function rptApplyFilters(){
  const typeSel=document.getElementById('rptType');
  const presetSel=document.getElementById('rptDatePreset');
  const ownerSel=document.getElementById('rptOwner');
  const srcSel=document.getElementById('rptSource');
  if(typeSel)rptState.type=typeSel.value;
  if(presetSel)rptState.preset=presetSel.value;
  if(rptState.preset==='custom'){
    rptState.dateFrom=document.getElementById('rptDateFrom')?.value||'';
    rptState.dateTo=document.getElementById('rptDateTo')?.value||'';
  }
  if(ownerSel)rptState.owner=ownerSel.value;
  if(srcSel)rptState.source=srcSel.value;
  rptRenderPreview();
}
function rptToggleExportMenu(e){
  if(e)e.stopPropagation();
  const menu=document.getElementById('rptExportMenu');if(menu)menu.classList.toggle('open');
}
document.addEventListener('click',e=>{
  const menu=document.getElementById('rptExportMenu');
  const wrap=document.querySelector('.rpt-export-wrap');
  if(menu&&menu.classList.contains('open')&&wrap&&!wrap.contains(e.target))menu.classList.remove('open');
});

/* --- CSV export (PDF intentionally left as a disabled menu item above
   until a real PDF pipeline exists — no fake PDF generation) --- */
function rptCsvEscape(val){
  const s=String(val==null?'':val);
  if(/[",\n]/.test(s))return'"'+s.replace(/"/g,'""')+'"';
  return s;
}
function rptDownloadCsv(filename,rows){
  const csv=rows.map(r=>r.map(rptCsvEscape).join(',')).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function rptExportCSV(){
  const menu=document.getElementById('rptExportMenu');if(menu)menu.classList.remove('open');
  const stamp=new Date().toISOString().slice(0,10);
  let rows=[],name='report';
  switch(rptState.type){
    case'sales_summary':{
      const d=rptSalesSummaryData();name='sales-summary';
      rows.push(['Sales Summary']);rows.push(['Range',rptRangeLabel()]);rows.push([]);
      rows.push(['Metric','Value']);
      d.kpis.forEach(k=>rows.push([k.label,k.value]));
      rows.push([]);rows.push(d.table.headers);
      d.table.rows.forEach(r=>rows.push(r));
      break;
    }
    case'owner_performance':{
      const{rows:orows}=rptOwnerPerformanceData();name='owner-performance';
      if(!orows.length){toast('No data to export for this filter combination','err');return;}
      rows.push(['Owner Performance']);rows.push(['Range',rptRangeLabel()]);rows.push([]);
      rows.push(['Owner','Total Leads','Won','Lost','Win Rate','Revenue Won']);
      orows.forEach(r=>rows.push([r.owner,r.total,r.won,r.lost,r.wr!==null?r.wr+'%':'',r.revenue>0?r.revenue.toFixed(2):'']));
      break;
    }
    case'pipeline_snapshot':{
      const{total,rows:prows}=rptPipelineSnapshotData();name='pipeline-snapshot';
      if(!total){toast('No data to export for this filter combination','err');return;}
      rows.push(['Pipeline Snapshot']);rows.push(['Range',rptRangeLabel()]);rows.push([]);
      rows.push(['Stage','Leads','% of Filtered Pipeline','Stage Value']);
      prows.forEach(r=>rows.push([r.stage,r.count,r.pct+'%',r.value>0?r.value.toFixed(2):'']));
      break;
    }
    case'source_performance':{
      const{rows:srows}=rptSourcePerformanceData();name='source-performance';
      if(!srows.length){toast('No data to export for this filter combination','err');return;}
      rows.push(['Source / Channel Performance']);rows.push(['Range',rptRangeLabel()]);rows.push([]);
      rows.push(['Source','Leads','Won','Won %','Revenue Won']);
      srows.forEach(r=>rows.push([r.source,r.total,r.won,r.convRate+'%',r.revenue>0?r.revenue.toFixed(2):'']));
      break;
    }
    case'activity_report':
      toast('Activity Report export isn\'t available yet — activity data isn\'t connected at the team level','err');
      return;
  }
  rptDownloadCsv(`upclose-${name}-${stamp}.csv`,rows);
  toast('✓ CSV exported','ok');
}


async function renderReports(){
  const body=document.getElementById('rptPreviewBody');
  if(!allLeads.length){
    if(body)body.innerHTML=rptEmptyState('summarize','No lead data loaded yet. Reports will populate automatically once leads sync.');
    const note=document.getElementById('rptFilterNote');if(note)note.textContent='—';
    return;
  }
  if(body)body.innerHTML=`<div class="loading-row"><span class="spin mat sm">sync</span> Loading report…</div>`;
  try{
    await rptPopulateFilterOptions();
    rptRenderPreview();
  }catch(e){
    console.error('renderReports failed:',e);
    if(body)body.innerHTML=rptEmptyState('error','Something went wrong building this report. Try Refresh above.');
  }
}

function renderAnalytics(){
  if(!allLeads.length&&page()!=='analytics')return;
  const leads=allLeads;
  const total=leads.length;
  const active=leads.filter(l=>l.status==='Potential').length;
  const won=leads.filter(l=>l.status==='Won').length;
  const lost=leads.filter(l=>l.status==='Lost').length;
  const closed=won+lost;
  const convRate=closed>0?Math.round((won/closed)*100):null;
  const meetings=leads.filter(l=>l.preferred_date).length;
  const now=new Date();
  const todayStr=now.toISOString().slice(0,10);


  const s=id=>document.getElementById(id);
  if(s('an-total'))s('an-total').textContent=total||'0';
  if(s('an-active')){s('an-active').textContent=active||'0';}
  if(s('an-won')){s('an-won').textContent=won||'0';}
  if(s('an-won-pct'))s('an-won-pct').textContent=total>0?Math.round((won/total)*100)+'% of total':'0%';
  if(s('an-lost')){s('an-lost').textContent=lost||'0';}
  if(s('an-lost-pct'))s('an-lost-pct').textContent=closed>0?Math.round((lost/closed)*100)+'% of closed':'0%';
  if(s('an-conv')){s('an-conv').textContent=convRate!==null?convRate+'%':'—';s('an-conv').style.color=convRate===null?'var(--tx3)':convRate>=50?'var(--gr)':convRate>=25?'var(--am)':'var(--re)';}
  if(s('an-meetings'))s('an-meetings').textContent=meetings||'0';


  const monthData=[];
  for(let i=7;i>=0;i--){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const label=d.toLocaleString('default',{month:'short'});
    const newLeads=leads.filter(l=>{if(!l.created_at)return false;const lk=l.created_at.slice(0,7);return lk===key;}).length;
    const convs=leads.filter(l=>{if(!l.converted_at&&l.status!=='Won')return false;const dt=l.converted_at||l.created_at;if(!dt)return false;return dt.slice(0,7)===key&&l.status==='Won';}).length;
    monthData.push({label,newLeads,convs});
  }
  const maxVal=Math.max(...monthData.map(m=>m.newLeads),1);
  const chartEl=s('an-monthly-chart');
  const labelsEl=s('an-monthly-labels');
  if(chartEl){
    chartEl.innerHTML=monthData.map((m,i)=>{
      const nh=Math.max(4,Math.round((m.newLeads/maxVal)*110));
      const ch=Math.max(0,Math.round((m.convs/maxVal)*110));
      const isNow=i===7;
      return `<div style="flex:1;display:flex;align-items:flex-end;gap:2px;position:relative" title="${m.label}: ${m.newLeads} leads, ${m.convs} won">
        <div style="flex:1;background:${isNow?'var(--pri-c)':'rgba(124,58,237,0.35)'};border-radius:3px 3px 0 0;height:${nh}px;transition:height .3s;cursor:pointer" onmouseover="this.style.background='var(--pri-c)'" onmouseout="this.style.background='${isNow?'var(--pri-c)':'rgba(124,58,237,0.35)'}'" title="${m.newLeads} new leads"></div>
        <div style="flex:1;background:${ch>0?'rgba(74,222,128,0.5)':'transparent'};border-radius:3px 3px 0 0;height:${ch}px;transition:height .3s;cursor:pointer" title="${m.convs} conversions"></div>
      </div>`;
    }).join('');
  }
  if(labelsEl){
    labelsEl.innerHTML=monthData.map((m,i)=>`<div style="flex:1;text-align:center;font-size:10px;font-weight:${i===7?'700':'500'};color:${i===7?'var(--acc)':'var(--tx3)'};letter-spacing:0.04em">${m.label}</div>`).join('');
  }


  const funnelEl=s('an-funnel');
  if(funnelEl){
    const totalF=total||1;
    const contacted=leads.filter(l=>l.last_contacted_at).length;
    const qualified=leads.filter(l=>l.pipeline_stage&&['Qualified','Appointment','Proposal','Negotiation','Won'].includes(l.pipeline_stage)).length||(leads.filter(l=>l.status==='Won'||l.preferred_date).length);
    const meetSched=meetings;
    const wonF=won;
    const stages=[
      {label:'Leads',count:total,color:'var(--bl)',icon:'people'},
      {label:'Contacted',count:contacted,color:'var(--pu)',icon:'call'},
      {label:'Qualified',count:qualified,color:'var(--am)',icon:'verified'},
      {label:'Mtg Scheduled',count:meetSched,color:'var(--acc)',icon:'event'},
      {label:'Won',count:wonF,color:'var(--gr)',icon:'check_circle'},
    ];
    funnelEl.innerHTML=stages.map((st,i)=>{
      const pct=Math.round((st.count/totalF)*100);
      const w=Math.max(20,pct);
      const prev=i>0?stages[i-1].count||1:totalF;
      const convPct=prev>0?Math.round((st.count/prev)*100):0;
      return `<div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="mat sm" style="color:${st.color};font-size:15px">${st.icon}</span>
            <span style="font-size:13px;font-weight:600;color:var(--tx)">${st.label}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;font-weight:700;color:${st.color}">${st.count}</span>
            <span style="font-size:11px;color:var(--tx3)">${i>0?convPct+'%':''}</span>
          </div>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
          <div style="height:100%;border-radius:3px;background:${st.color};width:${w}%;transition:width .4s ease;opacity:0.85"></div>
        </div>
      </div>`;
    }).join('');
  }


  const closedLeads=leads.filter(l=>l.status==='Won'&&l.converted_at&&l.created_at);
  const avgMs=closedLeads.length?closedLeads.reduce((sum,l)=>sum+Math.max(0,new Date(l.converted_at)-new Date(l.created_at)),0)/closedLeads.length:null;
  const velDays=avgMs?Math.round(avgMs/86400000):null;
  if(s('an-velocity'))s('an-velocity').textContent=velDays?velDays+' days':'—';
  if(s('an-efficiency'))s('an-efficiency').textContent=convRate!==null?'+'+convRate+'% win':'—';

 
  const ownerMap={};
  leads.forEach(l=>{
    const owner=l.owner_id||l.account_manager||'Unassigned';
    if(!ownerMap[owner])ownerMap[owner]={total:0,won:0,lost:0};
    ownerMap[owner].total++;
    if(l.status==='Won')ownerMap[owner].won++;
    if(l.status==='Lost')ownerMap[owner].lost++;
  });
  const ownerEntries=Object.entries(ownerMap).sort((a,b)=>b[1].total-a[1].total);
  const hasOwners=ownerEntries.some(([k])=>k!=='Unassigned')||ownerEntries.length>0;
  const ownerBody=s('an-owner-body');
  if(ownerBody){
    if(!ownerEntries.length||ownerEntries.every(([k])=>k==='Unassigned'&&ownerEntries.length===1)){
      ownerBody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--tx3);font-size:13px"><span class="mat sm" style="display:block;margin-bottom:6px;opacity:0.3;font-size:23px">person_off</span>No owner data — assign owners to leads to see performance</td></tr>`;
    }else{
      const maxTotal=ownerEntries[0][1].total||1;
      ownerBody.innerHTML=ownerEntries.map(([owner,d])=>{
        const closed=d.won+d.lost;
        const wr=closed>0?Math.round((d.won/closed)*100):null;
        const pct=Math.round((d.total/maxTotal)*100);
        const initl=initials(owner);
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:8px">
            <div class="av" style="background:var(--acc-d);color:var(--acc);font-size:11px;width:26px;height:26px">${initl}</div>
            <span style="font-weight:600;font-size:14px">${owner}</span>
          </div></td>
          <td style="font-weight:600">${d.total}</td>
          <td style="color:var(--gr);font-weight:600">${d.won}</td>
          <td style="color:var(--re)">${d.lost}</td>
          <td><span style="font-weight:700;color:${wr===null?'var(--tx3)':wr>=50?'var(--gr)':'var(--am)'}">${wr!==null?wr+'%':'—'}</span></td>
          <td style="min-width:80px"><div class="ftrack" style="width:80px"><div class="ffill" style="width:${pct}%;background:var(--acc)"></div></div></td>
        </tr>`;
      }).join('');
    }
  }

 
  const srcEl=s('an-sources');
  if(srcEl){
    const srcMap={};
    leads.forEach(l=>{const src=l.utm_source||l.referral||'Direct';if(!srcMap[src])srcMap[src]={total:0,won:0};srcMap[src].total++;if(l.status==='Won')srcMap[src].won++;});
    const srcEntries=Object.entries(srcMap).sort((a,b)=>b[1].total-a[1].total).slice(0,7);
    const colors=['var(--acc)','var(--bl)','var(--am)','var(--gr)','var(--pu)','var(--re)','var(--tx2)'];
    if(!srcEntries.length){srcEl.innerHTML=`<div style="text-align:center;padding:20px;color:var(--tx3);font-size:13px">No source data</div>`;
    }else{
      const maxSrc=srcEntries[0][1].total||1;
      srcEl.innerHTML=`<div class="src-bar-wrap">`+srcEntries.map(([src,d],i)=>{
        const pct=Math.round((d.total/total)*100);
        const bar=Math.round((d.total/maxSrc)*100);
        return `<div class="src-row"><div class="src-row-hd">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:50%;background:${colors[i%colors.length]};display:inline-block;flex-shrink:0"></span><span class="src-row-name">${src}</span></span>
          <span style="display:flex;gap:8px;align-items:center"><span style="font-size:12px;font-weight:700;color:var(--tx)">${d.total}</span><span class="src-row-pct">${pct}%</span></span>
        </div><div class="src-bar-track"><div class="src-bar-fill" style="width:${bar}%;background:${colors[i%colors.length]}"></div></div></div>`;
      }).join('')+'</div>';
    }
  }


  const riskEl=s('an-risk');
  if(riskEl){
    const overdue=leads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now&&l.status==='Potential').length;
    const upcoming=leads.filter(l=>{if(!l.preferred_date)return false;const d=l.preferred_date.slice(0,10);const in7=new Date(now);in7.setDate(now.getDate()+7);return d>=todayStr&&d<=in7.toISOString().slice(0,10);}).length;
    const inactive=leads.filter(l=>{if(l.status!=='Potential')return false;if(!l.last_contacted_at&&!l.created_at)return true;const last=new Date(l.last_contacted_at||l.created_at);const days=(now-last)/86400000;return days>30;}).length;
    const noContact=leads.filter(l=>!l.last_contacted_at&&l.status==='Potential').length;
    const riskItems=[
      {icon:'warning',color:'var(--re)',label:'Overdue Follow-ups',count:overdue,sub:'past due date'},
      {icon:'event_upcoming',color:'var(--am)',label:'Upcoming Meetings',count:upcoming,sub:'next 7 days'},
      {icon:'person_off',color:'var(--pu)',label:'Never Contacted',count:noContact,sub:'potential leads'},
      {icon:'schedule',color:'var(--tx3)',label:'Inactive 30d+',count:inactive,sub:'no recent activity'},
    ];
    riskEl.innerHTML=riskItems.map(r=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:${r.count>0&&r.color==='var(--re)'?'var(--re-d)':r.count>0&&r.color==='var(--am)'?'var(--am-d)':'var(--bg)'};border:1px solid ${r.count>0&&r.color==='var(--re)'?'rgba(248,113,113,0.2)':r.count>0&&r.color==='var(--am)'?'rgba(251,191,36,0.2)':'var(--bd)'};border-radius:7px">
      <div style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;flex-shrink:0"><span class="mat sm" style="color:${r.color}">${r.icon}</span></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--tx)">${r.label}</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:1px">${r.sub}</div>
      </div>
      <div style="font-size:21px;font-weight:800;color:${r.count>0?r.color:'var(--tx3)'};letter-spacing:-0.02em">${r.count}</div>
    </div>`).join('');
  }


  const last30=leads.filter(l=>{if(!l.created_at)return false;return (now-new Date(l.created_at))/86400000<=30;}).length;
  if(s('an-growth'))s('an-growth').textContent=last30;
  if(s('an-winrate'))s('an-winrate').textContent=convRate!==null?convRate+'%':'—';
  const meetingPct=total>0?Math.round((meetings/total)*100):0;
  if(s('an-meeting-pct'))s('an-meeting-pct').textContent=meetingPct+'%';
  if(s('an-lead-velocity'))s('an-lead-velocity').textContent=velDays?velDays+'d':'—';

  const healthEl=s('an-health-text');
  if(healthEl){
    const score=closed>0?Math.round((won/closed)*100):0;
    const contactedPct=total>0?Math.round((leads.filter(l=>l.last_contacted_at).length/total)*100):0;
    let narrative=`Pipeline contains <strong style="color:var(--tx)">${total} leads</strong> — `;
    narrative+=`<strong style="color:var(--bl)">${active} active</strong>, <strong style="color:var(--gr)">${won} won</strong>, <strong style="color:var(--re)">${lost} lost</strong>. `;
    if(convRate!==null)narrative+=`Win rate is <strong style="color:${convRate>=50?'var(--gr)':convRate>=25?'var(--am)':'var(--re)'}">${convRate}%</strong>. `;
    narrative+=`<strong style="color:var(--tx)">${contactedPct}%</strong> of leads have been contacted. `;
    if(velDays)narrative+=`Average close time: <strong style="color:var(--am)">${velDays} days</strong>. `;
    const overdueN=leads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now&&l.status==='Potential').length;
    if(overdueN>0)narrative+=`<strong style="color:var(--re)">${overdueN} overdue follow-up${overdueN!==1?'s':''}</strong> require immediate action.`;
    else narrative+=`<strong style="color:var(--gr)">No overdue follow-ups</strong> — pipeline is well managed.`;
    healthEl.innerHTML=narrative;
  }
}

/* ============================================================
   FUNNEL METRICS
   Reads utm_source/campaign, preferred_date (booked call), show_status,
   offer_made and deal_value directly off allLeads — no new backend needed
   for the funnel counts themselves. Ad spend is the one number that truly
   doesn't live on a lead, so it's captured per-period below.
   ============================================================ */
let fnPeriodDays=7;
function fnPeriodKey(){return `nxtup-adspend-${fnPeriodDays}`;}
async function fnLoadAdSpend(){
  try{
    const res=await fetch(API.adSpend+`?days=${fnPeriodDays}`);
    if(!res.ok)throw new Error('no endpoint yet');
    const data=await res.json();
    document.getElementById('fnAdSpendNote').textContent='Loaded from your ad-spend webhook.';
    return parseFloat(data.amount)||0;
  }catch(e){
    document.getElementById('fnAdSpendNote').innerHTML='Saved locally in this browser until the <code>ad-spend</code> n8n webhook is connected.';
    return parseFloat(localStorage.getItem(fnPeriodKey()))||0;
  }
}
async function fnSaveAdSpend(){
  const val=parseFloat(document.getElementById('fnAdSpendInput').value)||0;
  try{
    const res=await fetch(API.adSpend,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days:fnPeriodDays,amount:val})});
    if(!res.ok)throw new Error('no endpoint yet');
    toast('✓ Ad spend saved to server','ok');
  }catch(e){
    localStorage.setItem(fnPeriodKey(),String(val));
    toast('✓ Ad spend saved locally (webhook not connected yet)','ok');
  }
  renderFunnelDashboard();
}
function fnSetPeriod(days){
  fnPeriodDays=days;
  document.querySelectorAll('#fnPeriodGroup .topt').forEach(t=>t.classList.toggle('active',parseInt(t.dataset.period)===days));
  renderFunnelDashboard();
}
function fnLeadsInPeriod(){
  if(!fnPeriodDays)return allLeads;
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-fnPeriodDays);
  return allLeads.filter(l=>l.created_at&&new Date(l.created_at)>=cutoff);
}
function fnStageCard(label,count,pctOfPrev,icon){
  return `<div class="card" style="flex:1;padding:14px 16px;min-width:0">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span class="mat sm" style="color:var(--tx3)">${icon}</span><span class="mlbl">${label}</span></div>
    <div class="mval">${count}</div>
    ${pctOfPrev!==null?`<div class="stat-trend neutral" style="margin-top:4px">${pctOfPrev}% of previous stage</div>`:''}
  </div>`;
}
function fnMetricCard(label,value,valid,hint){
  return `<div class="stat-card ${valid?'c-acc':''}" style="padding:14px 16px">
    <div class="mlbl">${label}</div>
    ${valid?`<div class="mval" style="margin:5px 0 3px">${value}</div>`:`<div style="margin:8px 0 3px;font-size:13px;color:var(--am);display:flex;align-items:center;gap:4px"><span class="mat sm">warning</span>Missing data</div>`}
    <div class="stat-trend neutral" style="margin-top:2px">${hint}</div>
  </div>`;
}
async function renderFunnelDashboard(){
  const spend=await fnLoadAdSpend();
  document.getElementById('fnAdSpendInput').value=spend||'';
  const leads=fnLeadsInPeriod();
  const booked=leads.filter(l=>l.preferred_date).length;
  const shown=leads.filter(l=>l.show_status==='showed').length;
  const offered=leads.filter(l=>l.offer_made===true).length;
  const won=leads.filter(l=>l.status==='Won').length;
  const noShow=leads.filter(l=>l.show_status==='no_show').length;

  document.getElementById('fnFunnelStages').innerHTML=
    fnStageCard('Booked Calls',booked,null,'event_available')+
    fnStageCard('Shown',shown,booked?Math.round(shown/booked*100):0,'how_to_reg')+
    fnStageCard('Offers Made',offered,shown?Math.round(offered/shown*100):0,'local_offer')+
    fnStageCard('Won',won,offered?Math.round(won/offered*100):0,'check_circle');

  const cpbc=spend>0&&booked>0?spend/booked:null;
  const cps=spend>0&&shown>0?spend/shown:null;
  const cpa=spend>0&&won>0?spend/won:null;
  const showRate=booked>0?(shown/booked*100):null;
  const closeRate=leads.length>0?(won/leads.length*100):null;
  const offerRate=shown>0?(offered/shown*100):null;

  document.getElementById('fnMetricsGrid').innerHTML=
    fnMetricCard('Cost per Booked Call',cpbc!==null?'$'+cpbc.toFixed(2):'—',cpbc!==null,spend>0?`${booked} booked calls`:'Enter ad spend above')+
    fnMetricCard('Cost per Show',cps!==null?'$'+cps.toFixed(2):'—',cps!==null,spend>0?`${shown} shown, ${noShow} no-show`:'Enter ad spend above')+
    fnMetricCard('Cost per Acquisition',cpa!==null?'$'+cpa.toFixed(2):'—',cpa!==null,spend>0?`${won} won`:'Enter ad spend above')+
    fnMetricCard('Show Rate',showRate!==null?showRate.toFixed(0)+'%':'—',showRate!==null,booked?`${shown}/${booked} showed`:'No booked calls yet')+
    fnMetricCard('Close Rate',closeRate!==null?closeRate.toFixed(0)+'%':'—',closeRate!==null,`${won}/${leads.length} won`)+
    fnMetricCard('Offer Rate',offerRate!==null?offerRate.toFixed(0)+'%':'—',offerRate!==null,shown?`${offered}/${shown} offered`:'Mark meetings as "Showed" first')+
    fnMetricCard('No-Show Rate',booked?((noShow/booked)*100).toFixed(0)+'%':'—',booked>0,booked?`${noShow}/${booked} no-show`:'No booked calls yet')+
    fnMetricCard('Total Ad Spend',spend>0?'$'+spend.toFixed(2):'—',spend>0,fnPeriodDays?`Last ${fnPeriodDays} days`:'All time');

  const wonLeads=allLeads.filter(l=>l.status==='Won'&&l.deal_value);
  const avgLtv=wonLeads.length?wonLeads.reduce((s,l)=>s+parseFloat(l.deal_value||0),0)/wonLeads.length:null;
  const totalRevenue=wonLeads.reduce((s,l)=>s+parseFloat(l.deal_value||0),0);
  document.getElementById('fnLtvRow').innerHTML=`
    <div class="csm" style="padding:14px 16px"><div class="kpi-sub">Average LTV (Won deals)</div><div class="kpi-val-lg">${avgLtv!==null?'$'+avgLtv.toFixed(2):'—'}</div><div class="kpi-sub ${avgLtv===null?'kpi-warn':''}">${avgLtv!==null?wonLeads.length+' won deals with a value':'Enter Deal Value on won leads'}</div></div>
    <div class="csm" style="padding:14px 16px"><div class="kpi-sub">Total Revenue Won</div><div class="kpi-val-lg">${totalRevenue>0?'$'+totalRevenue.toFixed(2):'—'}</div><div class="kpi-sub">${wonLeads.length} of ${won} won leads have a value</div></div>
    <div class="csm" style="padding:14px 16px"><div class="kpi-sub">CPA vs Avg LTV</div><div class="kpi-val-lg">${cpa!==null&&avgLtv!==null?(avgLtv/cpa).toFixed(2)+'x':'—'}</div><div class="kpi-sub">${cpa!==null&&avgLtv!==null?'Return per acquisition dollar':'Needs ad spend + deal values'}</div></div>`;
}

/* ============================================================
   VOICE / COMMUNICATION SERVICE — provider-agnostic architecture

       UPCLOSE UI  →  VoiceService  →  ProviderAdapter  →  Twilio

   The Communication Hub UI (below) only ever calls methods on
   VoiceService and listens to VoiceService events. It has no idea
   which telephony provider is behind it. Swapping Twilio for Telnyx,
   Vonage, etc. later means writing one new adapter class that
   satisfies the same contract — nothing in the UI changes.

   LIVE: API.getVoiceToken points at the real Twilio Voice Access Token
   endpoint (a Twilio Function) and TwilioVoiceAdapter below talks to the
   actual Twilio Voice JS SDK — real Device registration, real outbound
   calls, real call-lifecycle events. Nothing in this file simulates a
   call or a call state. The browser only ever receives the short-lived
   Access Token returned by that endpoint; no Account SID, API Key, API
   Key Secret, or Auth Token exists anywhere in this file.
   ============================================================ */

const CallState=Object.freeze({
  IDLE:'idle',
  CONNECTING:'connecting',
  RINGING:'ringing',
  ACTIVE:'active',
  ENDED:'ended',
  FAILED:'failed'
});

/* ---- Provider Adapter contract ----
   Every adapter (Twilio, Telnyx, ...) must implement:
     isConfigured()            -> boolean
     connect({phone, leadId})  -> Promise, resolves once the provider
                                   has actually accepted the call attempt.
                                   Must reject (never fake-resolve) if
                                   the provider isn't reachable/configured.
     disconnect()              -> ends the current call
     mute(bool)
     hold(bool)
     sendDigits(digit)         -> DTMF tone during an active call
     on(event, handler)        -> events: 'statechange' | 'incoming' | 'error'
   Adapters are the ONLY place provider-specific code (SDKs, REST
   calls, token formats) is allowed to live. */

class TwilioVoiceAdapter{
  constructor(){
    this._listeners={};
    this.device=null;          // single reused Twilio.Device instance
    this.activeConnection=null; // the current Twilio.Call, if any
    this._deviceReadyPromise=null; // in-flight device init, so concurrent
                                    // connect() calls don't race two devices
    // Flipped to true only once Twilio.Device has actually finished
    // registering with Twilio. Never set true optimistically.
    this._configured=false;
  }
  isConfigured(){return this._configured;}
  on(evt,fn){(this._listeners[evt]=this._listeners[evt]||[]).push(fn);return this;}
  _emit(evt,payload){(this._listeners[evt]||[]).forEach(fn=>fn(payload));}

  /* ---- Token fetch ---- the only thing the browser is allowed to
     receive from the backend: a short-lived Access Token + identity.
     No secrets, no Account SID, ever. */
  async _fetchToken(){
    let res;
    try{
      res=await fetch(API.getVoiceToken);
    }catch(networkErr){
      const err=new Error('Could not reach the voice service (network error).');
      err.code='TOKEN_NETWORK_ERROR';
      throw err;
    }
    if(!res.ok){
      const err=new Error('Voice token endpoint returned an error (HTTP '+res.status+').');
      err.code='TOKEN_ENDPOINT_ERROR';
      throw err;
    }
    let data;
    try{ data=await res.json(); }catch(parseErr){
      const err=new Error('Voice token endpoint returned an invalid response.');
      err.code='TOKEN_ENDPOINT_ERROR';
      throw err;
    }
    if(!data||!data.token){
      const err=new Error('Voice token endpoint did not return a token.');
      err.code='TOKEN_ENDPOINT_ERROR';
      throw err;
    }
    return data; // {identity, token}
  }

  /* ---- Device lifecycle: created once, reused for every call ---- */
  async _ensureDevice(){
    if(this.device&&this._configured)return this.device;
    if(this._deviceReadyPromise)return this._deviceReadyPromise; // reuse in-flight init

    this._deviceReadyPromise=(async()=>{
      // Request mic access up front so we get one clear, specific error
      // ("permission denied") instead of a vague Twilio connection failure
      // later inside device.connect().
      try{
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        stream.getTracks().forEach(t=>t.stop()); // Device.connect() opens its own track
      }catch(micErr){
        const err=new Error('Microphone access was denied. Enable it in your browser settings to make calls.');
        err.code='MIC_PERMISSION_DENIED';
        throw err;
      }

      if(typeof Twilio==='undefined'||!Twilio.Device){
        const err=new Error('Twilio Voice SDK failed to load.');
        err.code='SDK_NOT_LOADED';
        throw err;
      }

      const {token}=await this._fetchToken();

      const device=new Twilio.Device(token,{
        codecPreferences:['opus','pcmu'],
        enableRingingState:true
      });

      device.on('error',(twErr)=>{
        this._emit('error',twErr);
        // A registration-time error means we're not usable yet.
        if(!this._configured){
          this._configured=false;
        }
      });

      // Keep the Access Token alive for long-running sessions — refetch
      // and hand Twilio a fresh token instead of tearing the Device down.
      device.on('tokenWillExpire',async()=>{
        try{
          const{token:freshToken}=await this._fetchToken();
          device.updateToken(freshToken);
        }catch(refreshErr){
          this._emit('error',refreshErr);
        }
      });

      device.on('unregistered',()=>{ this._configured=false; });

      await device.register();
      // register() resolves once Twilio confirms registration — only now
      // is it safe to call this adapter "configured".
      this.device=device;
      this._configured=true;
      return device;
    })();

    try{
      return await this._deviceReadyPromise;
    }catch(err){
      // Failed init — clear so the next call attempt retries from scratch
      // instead of being stuck on a rejected promise forever.
      this._deviceReadyPromise=null;
      this._configured=false;
      throw err;
    }
  }

  async connect(context){
    const phone=(context&&context.phone||'').trim();
    // Basic E.164-ish sanity check — real validation/formatting still
    // happens server-side in the TwiML App, this just catches obvious junk
    // before we spend a Twilio call attempt on it.
    if(!/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s().-]/g,''))){
      const err=new Error('That doesn\'t look like a valid phone number.');
      err.code='INVALID_NUMBER';
      throw err;
    }

    let device;
    try{
      device=await this._ensureDevice();
    }catch(err){
      // Re-throw with the specific reasons _ensureDevice/_fetchToken set,
      // so VoiceService/toast can show the real cause (mic denied, token
      // endpoint down, SDK missing, registration failure, network, ...).
      throw err;
    }

    let call;
    try{
      call=await device.connect({
        params:{
  To:phone.replace(/[\s().-]/g,''),
  leadId:context&&context.leadId!=null?String(context.leadId):'',
  userEmail:context&&context.userEmail?String(context.userEmail):''
}
      });
    }catch(connectErr){
      const err=new Error(connectErr&&connectErr.message||'Twilio call failed to start.');
      err.code='CALL_FAILED';
      throw err;
    }

    this.activeConnection=call;

    call.on('ringing',()=>this._emit('statechange',{state:CallState.RINGING}));
    call.on('accept',()=>this._emit('statechange',{state:CallState.ACTIVE}));
    call.on('disconnect',()=>{
      this._emit('statechange',{state:CallState.ENDED});
      this.activeConnection=null;
    });
    call.on('cancel',()=>{
      this._emit('statechange',{state:CallState.ENDED});
      this.activeConnection=null;
    });
    call.on('reject',()=>{
      this._emit('statechange',{state:CallState.FAILED,reason:'Call was rejected'});
      this.activeConnection=null;
    });
    call.on('error',(callErr)=>{
      this._emit('statechange',{state:CallState.FAILED,reason:(callErr&&callErr.message)||'Call failed'});
      this.activeConnection=null;
    });

    // Resolving here just means Twilio accepted the connection attempt —
    // VoiceService moves to CONNECTING already; RINGING/ACTIVE come from
    // the real Call events wired up above, not from this resolve.
  }

  disconnect(){this.activeConnection&&this.activeConnection.disconnect&&this.activeConnection.disconnect();}
  mute(on){this.activeConnection&&this.activeConnection.mute&&this.activeConnection.mute(on);}
  hold(on){
    /* NOT IMPLEMENTED: the Twilio Voice JS SDK has no native hold. A real
       implementation needs to move the call into a hold-music conference
       (or re-negotiate the media) via a server-side TwiML/REST change —
       that backend piece doesn't exist yet. Left as an intentional no-op;
       the Hold button is disabled in the UI (see chHoldBtn) rather than
       faking a hold state here. Do not wire this up to a fake state. */
  }
  sendDigits(digit){this.activeConnection&&this.activeConnection.sendDigits&&this.activeConnection.sendDigits(digit);}
}

/* ---- VoiceService: the single thing the Communication Hub UI talks to ---- */
const VoiceService={
  adapter:new TwilioVoiceAdapter(), // <- swap this one line to change provider later
  state:CallState.IDLE,
  activeLead:null,
  activeNumber:null,
  startedAt:null,
  _timerHandle:null,
  _listeners:{},

  on(evt,fn){(this._listeners[evt]=this._listeners[evt]||[]).push(fn);return this;},
  _emit(evt,payload){(this._listeners[evt]||[]).forEach(fn=>fn(payload));},

  isReady(){return this.adapter.isConfigured();},

  _setState(next,extra){
    this.state=next;
    this._emit('statechange',Object.assign({state:next,lead:this.activeLead,number:this.activeNumber},extra||{}));
  },

  async placeCall(lead,number){
    if(this.state==='connecting'||this.state==='ringing'||this.state==='active'){
      toast('A call is already in progress','err');return;
    }
    if(!number){toast('No phone number to call','err');return;}
    this.activeLead=lead||null;
    this.activeNumber=number;
    this.startedAt=null;
    this._setState(CallState.CONNECTING);
    try{
    await this.adapter.connect({
  phone:number,
  leadId:lead?lead.id:null,
  userEmail:(currentProfile&&currentProfile.email)||(currentUser&&currentUser.email)||''
});
      // A fully wired adapter will move state to RINGING then ACTIVE itself
      // via its own provider events. Nothing here assumes success.
    }catch(err){
      const reasonsByCode={
        PROVIDER_NOT_CONFIGURED:'Voice calling isn\'t connected yet — ask an admin to finish the Twilio setup',
        MIC_PERMISSION_DENIED:'Microphone access is blocked — allow it in your browser settings to make calls',
        TOKEN_NETWORK_ERROR:'Couldn\'t reach the voice service — check your connection and try again',
        TOKEN_ENDPOINT_ERROR:'Voice service is temporarily unavailable — try again shortly',
        SDK_NOT_LOADED:'Voice calling failed to load — refresh the page and try again',
        INVALID_NUMBER:'That doesn\'t look like a valid phone number',
        CALL_FAILED:(err&&err.message)||'Twilio couldn\'t start the call'
      };
      const reason=(err&&reasonsByCode[err.code])||(err&&err.message)||'Call failed';
      this._setState(CallState.FAILED,{reason});
    }
  },

  hangUp(){
    this.adapter.disconnect();
    this._setState(CallState.ENDED);
    this.activeLead=null;this.activeNumber=null;
  },
  toggleMute(on){this.adapter.mute(on);this._emit('mute',on);},
  toggleHold(on){this.adapter.hold(on);this._emit('hold',on);},
  sendDigit(d){this.adapter.sendDigits(d);}

  /* Inbound calling: no adapter above wires up an 'incoming' event yet,
     because no inbound provider integration exists. Once one does, it
     should call VoiceService._emit('incoming', {...}) and the Communication
     Hub listener below (chIncoming*) will surface the existing banner UI —
     no further UI work needed. */
};

/* The adapter emits real Twilio Call events (ringing/accept/disconnect/
   cancel/reject/error, see TwilioVoiceAdapter.connect above) on its OWN
   event bus as 'statechange'/'error'. Forward those into VoiceService's
   state machine so the call bar reacts to what Twilio is actually doing,
   not just to the initial placeCall() attempt. */
VoiceService.adapter.on('statechange',(evt)=>{
  VoiceService._setState(evt.state,evt.reason?{reason:evt.reason}:undefined);
});
VoiceService.adapter.on('error',(err)=>{
  // Device-level errors that happen outside an active connect() attempt
  // (e.g. a failed token refresh mid-call, a registration drop). Surface
  // it through the existing toast system rather than silently swallowing it.
  toast((err&&err.message)||'Voice connection error','err');
});

/* ============================================================
   COMMUNICATION HUB — UPCLOSE-owned communication experience.
   Contacts are the real lead records already loaded into allLeads
   (same array used by Leads/Pipeline/Clients) — no separate demo
   dataset. Sending messages, logging calls and pulling the activity
   timeline call the API.* endpoints above, which are backed by
   UPCLOSE's own n8n workflows against PostgreSQL. Any external CRM
   sync (legacy or otherwise) happens server-side, behind those
   workflows — this UI has no direct dependency on, or knowledge of,
   any specific third-party backend. Until a given workflow is wired
   up, every call fails gracefully and the UI honestly shows "Not
   connected" instead of fabricating data.

   Voice calling specifically is handled by VoiceService, a provider-
   agnostic layer defined below (see "VOICE / COMMUNICATION SERVICE").
   This section never talks to a telephony provider directly.
   ============================================================ */
let chActiveLeadId=null,chActiveChannel='email',chActiveTab='timeline',chActivities=[];

/* ---- General (cross-lead) Activity Timeline ----
   UI only for now. crm.activities is the source of truth.
   A backend bulk-activity endpoint will populate this array later. */
let genTimelineItems=[];
function genSetTimelineData(items){
  genTimelineItems=Array.isArray(items)?items:[];
  genRenderTimeline();
}
function genActivityMeta(type){
  if(type==='call')return{icon:'call',color:'bl'};
  if(type==='sms')return{icon:'sms',color:'gr'};
  if(type==='email')return{icon:'mail',color:'pu'};
  if(type==='note')return{icon:'edit_note',color:'gy'};
  return{icon:'circle',color:'gy'};
}
function genRenderTimeline(){
  const feed=document.getElementById('genTimelineFeed');
  if(!feed)return;
  const items=genTimelineItems;
  if(!items.length){
    feed.innerHTML='<div class="ch-timeline-empty"><span class="mat" style="font-size:33px;opacity:.35">cloud_off</span><p style="font-size:13.5px">All Activity is ready. Backend activity feed is not connected yet.</p></div>';
    return;
  }
  feed.innerHTML='<div class="lp-tl-wrap">'+items.map(a=>{
    const meta=genActivityMeta(a.type);
    const who=a.leadId?`<a style="color:var(--acc);cursor:pointer" onclick="chOpenInConversations(${a.leadId})">${escapeHtml(a.leadName||'Lead #'+a.leadId)}</a>`:escapeHtml(a.number||a.to||'Unknown');
    let label;
    if(a.type==='call'){
      const statusBadge=a.status?`<span class="badge ${a.status==='completed'?'gr':a.status==='failed'?'re':'am'}" style="margin-left:6px">${escapeHtml(a.status)}</span>`:'';
      label=`Outgoing call · ${who}${statusBadge}${a.duration?' · '+chFormatDuration(a.duration):''}`;
      if(!a.leadId)label+=' <span class="badge gy" style="margin-left:6px">unregistered number</span>';
    }else if(a.type==='sms'){
      label=`SMS to ${who}`;
    }else if(a.type==='email'){
      label=`Email to ${who}`;
    }else{
      label=`Note on ${who}`;
    }
    return `<div class="lp-tl-item">
      <div class="lp-tl-dot ${meta.color}"><span class="mat">${meta.icon}</span></div>
      <div class="lp-tl-content">
        <div class="lp-tl-txt">${label}</div>
        ${a.body?`<div style="font-size:13px;color:var(--tx2);margin-top:3px;line-height:1.5">${escapeHtml(a.body)}</div>`:''}
        <div class="lp-tl-meta" style="margin-top:4px">${fmtDate(a.created_at)}</div>
      </div>
    </div>`;
  }).join('')+'</div>';
}

function chDraftKey(leadId,channel){return'chDraft_'+leadId+'_'+channel;}

function chLoadDraft(){
  const body=document.getElementById('chComposerBody');
  if(!chActiveLeadId){body.value='';return;}
  body.value=localStorage.getItem(chDraftKey(chActiveLeadId,chActiveChannel))||'';
}

function chSaveDraft(){
  if(!chActiveLeadId){toast('Select a lead first','err');return;}
  const body=document.getElementById('chComposerBody');
  const key=chDraftKey(chActiveLeadId,chActiveChannel);
  if(!body.value.trim()){localStorage.removeItem(key);toast('Draft cleared');return;}
  localStorage.setItem(key,body.value);
  toast('Draft saved');
}

function chFilterByTab(items, tab) {
  if (tab === 'timeline') return items;

  const map = {
    calls: 'call',
    sms: 'sms',
    emails: 'email',
    notes: 'note'
  };

  const key = map[tab];

  return items.filter(a =>
    String(a.activity_type || '').toLowerCase() === key
  );
}
function chActivityMeta(type){
  const m={Call:{icon:'call',color:'bl'},SMS:{icon:'sms',color:'gr'},Email:{icon:'mail',color:'pu'},Note:{icon:'edit_note',color:'am'},review_request:{icon:'reviews',color:'pu'}};
  return m[type]||{icon:'history',color:'gy'};
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function chLeadName(l){return((l.first_name||'')+' '+(l.last_name||'')).trim()||'—';}

function chNeedsAttention(l){
  if(l.status!=='Potential')return false;
  if(l.next_followup_at&&new Date(l.next_followup_at)<new Date())return true;
  if(!l.last_contacted_at){
    const since=l.created_at?(Date.now()-new Date(l.created_at))/86400000:99;
    return since>2;
  }
  return false;
}

function chIsMine(l){
  if(!currentProfile)return true;
  const me=[currentProfile.id,currentProfile.email,currentProfile.full_name].filter(Boolean);
  return me.includes(l.owner_id);
}

/* ---- Seen tracking for "Needs Attention" ----
   Local-only, like starred/drafts: no "read" flag exists on the lead
   record itself. A lead is remembered as "seen" together with the
   exact next_followup_at/last_contacted_at it had at that moment —
   so if either changes afterward (new follow-up scheduled, contact
   info updated), it's treated as unseen again instead of staying
   hidden forever. */
const CH_SEEN_KEY='upclose_seen_attention_v1';
function chLoadSeenMap(){try{return JSON.parse(localStorage.getItem(CH_SEEN_KEY)||'{}');}catch(e){return{};}}
let chSeenMap=chLoadSeenMap();
function chAttentionSignature(l){return(l.next_followup_at||'')+'|'+(l.last_contacted_at||'');}
function chMarkSeen(l){
  if(!l)return;
  chSeenMap[l.id]=chAttentionSignature(l);
  localStorage.setItem(CH_SEEN_KEY,JSON.stringify(chSeenMap));
}

function chAuthHeaders(){
  return{'Content-Type':'application/json','X-API-Key':N8N_API_KEY};
}

/* ---- Starred conversations — local-only, like drafts/snippets.
   No backend flag exists for this, so it's stored per-device in
   localStorage rather than faked as server-synced state. ---- */
const CH_STARRED_KEY='upclose_starred_leads_v1';
function chLoadStarred(){try{return new Set(JSON.parse(localStorage.getItem(CH_STARRED_KEY)||'[]'));}catch(e){return new Set();}}
let chStarredSet=chLoadStarred();
function chIsStarred(id){return chStarredSet.has(id);}
function chToggleStar(id){
  if(chStarredSet.has(id))chStarredSet.delete(id);else chStarredSet.add(id);
  localStorage.setItem(CH_STARRED_KEY,JSON.stringify([...chStarredSet]));
  chRenderContactList(chFilteredLeads(chCurrentView()));
  if(id===chActiveLeadId)chUpdateStarIcon();
  chUpdateCounts();
}
function chUpdateStarIcon(){
  const btn=document.getElementById('chQaStar');if(!btn)return;
  const on=chIsStarred(chActiveLeadId);
  btn.classList.toggle('starred',on);
  btn.querySelector('.mat').textContent=on?'star':'star_outline';
}

let chSortMode='default';
function chSortLeads(list){
  const arr=list.slice();
  if(chSortMode==='name')arr.sort((a,b)=>chLeadName(a).localeCompare(chLeadName(b)));
  else if(chSortMode==='recent')arr.sort((a,b)=>new Date(b.last_contacted_at||0)-new Date(a.last_contacted_at||0));
  return arr;
}

function chFilteredLeads(view){
  const todayStr=new Date().toISOString().slice(0,10);
  switch(view){
    case'attention':return allLeads.filter(l=>chNeedsAttention(l)&&chSeenMap[l.id]!==chAttentionSignature(l));
    case'mine':return allLeads.filter(l=>l.status==='Potential'&&chIsMine(l));
    case'calls':return allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr);
    case'unanswered':return allLeads.filter(l=>!l.last_contacted_at&&l.status==='Potential');
    case'starred':return allLeads.filter(l=>chIsStarred(l.id));
    /* "Recent" = contacted in the last 14 days, most-recent first — a real
       filter over last_contacted_at, not a fabricated inbox concept. */
    case'recent':{
      const cutoff=Date.now()-14*86400000;
      return allLeads.filter(l=>l.last_contacted_at&&new Date(l.last_contacted_at).getTime()>=cutoff)
        .sort((a,b)=>new Date(b.last_contacted_at)-new Date(a.last_contacted_at));
    }
    default:return allLeads;
  }
}

function chUpdateCounts(){
  const attn=chFilteredLeads('attention').length;
  setEl('chSvCountAttention',attn);
  setEl('chSvCountAll',allLeads.length);
  setEl('chSvCountRecent',chFilteredLeads('recent').length);
  setEl('chSvCountStarred',chFilteredLeads('starred').length);
  const overdue=typeof chManualRows==='function'?chManualRows('overdue').length:0;
  const manualBadge=document.getElementById('chSubBadgeManual');
  if(manualBadge){manualBadge.style.display=overdue>0?'':'none';manualBadge.textContent=overdue;}
  const navBadge=document.getElementById('navCountAttention');
  if(navBadge){navBadge.style.display=attn>0?'':'none';navBadge.textContent=attn;}
}

function chCurrentView(){const el=document.querySelector('#chSmartViews .ch-sv.active');return el?el.dataset.view:'attention';}

let chLastRenderedList=[];
function chRenderContactList(list){
  const wrap=document.getElementById('chContactList');if(!wrap)return;
  list=chSortLeads(list);
  chLastRenderedList=list;
  if(!list.length){wrap.innerHTML='<div class="empty-state"><span class="mat">person_search</span><p>No leads in this view.</p></div>';return;}
  wrap.innerHTML=list.map(l=>{
    const name=chLeadName(l);
    const st=l.status||'Potential';
    const stCls=scClass(st);
    const last=l.last_contacted_at?fmtDate(l.last_contacted_at):'No contact yet';
    const starred=chIsStarred(l.id);
    const needsAttn=chNeedsAttention(l);
    return`<div class="ch-contact${l.id===chActiveLeadId?' active':''}" data-id="${l.id}">
      <div class="av ${stCls}">${initials(l.company_name||name)}</div>
      <div class="ch-contact-body">
        <div class="ch-contact-top"><span class="ch-contact-name">${name}</span><span class="ch-contact-time">${last}</span></div>
        <div class="ch-contact-sub">${l.company_name||'—'}</div>
        <div class="ch-contact-meta"><span class="badge ${stCls}">${st}</span>${needsAttn?'<span class="ch-contact-badge" title="Needs attention">!</span>':''}
          <button class="ch-star-btn${starred?' starred':''}" title="${starred?'Starred (this device)':'Star (this device)'}" data-star="${l.id}" style="margin-left:auto"><span class="mat">${starred?'star':'star_outline'}</span></button>
        </div>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.ch-contact').forEach(row=>row.addEventListener('click',(e)=>{if(e.target.closest('[data-star]'))return;chSelectLead(parseInt(row.dataset.id));}));
  wrap.querySelectorAll('[data-star]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();chToggleStar(parseInt(btn.dataset.star));}));
}

function chSelectLead(id){
  chActiveLeadId=id;
  const l=allLeads.find(x=>x.id===id);
  if(l&&chNeedsAttention(l)){chMarkSeen(l);chUpdateCounts();}
  chRenderContactList(chFilteredLeads(chCurrentView()));
  if(!l)return;
  const name=chLeadName(l);
  setEl('chHeaderName',name);setEl('chHeaderSub',l.company_name||'—');
  document.getElementById('chHeaderAvatar').textContent=initials(l.company_name||name);

  document.getElementById('chComposerBody').disabled=false;
  document.getElementById('chComposerSendBtn').disabled=false;
  document.getElementById('chComposerDraftBtn').disabled=false;

  const qaSms=document.getElementById('chQaSms'),qaEmail=document.getElementById('chQaEmail'),qaCall=document.getElementById('chQaCall'),pqCall=document.getElementById('chPqCall'),pqSms=document.getElementById('chPqSms');
  qaSms.style.opacity=pqSms.style.opacity=l.phone?'1':'0.35';
  qaSms.title=pqSms.title=l.phone?'SMS':'No phone number on file';
  qaEmail.style.opacity=l.email?'1':'0.35';
  qaEmail.title=l.email?'Email':'No email on file';
  qaCall.style.opacity=pqCall.style.opacity=l.phone?'1':'0.35';
  qaCall.title=pqCall.title=l.phone?'Call':'No phone number on file';

  chActiveTab='timeline';
  document.querySelectorAll('#chCommTabs .ch-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab==='timeline'));
  chUpdateStarIcon();

  document.getElementById('chProfileEmptyState').style.display='none';
  document.getElementById('chProfileContent').style.display='block';
  document.getElementById('chProfileAvatar').textContent=initials(l.company_name||name);
  setEl('chProfileName',name);setEl('chProfileTitle',l.company_name||'—');
  document.getElementById('chProfileStatus').textContent=l.status||'—';
  setEl('chProfileStage',l.pipeline_stage||defaultStage(l));
  setEl('chProfileSourceVal',l.utm_source||'—');
  setEl('chProfileCampaign',l.utm_campaign||'—');
  setEl('chProfileMedium',l.utm_medium||'—');
  setEl('chProfileOwner',closersMap[l.owner_id]||l.owner_id||'Unassigned');
  ensureClosersLoaded().then(()=>{if(chActiveLeadId===id)setEl('chProfileOwner',closersMap[l.owner_id]||l.owner_id||'Unassigned');});
  setEl('chProfileCompany',l.company_name||'—');
  document.getElementById('chProfileEmail').innerHTML=l.email?`<a href="mailto:${l.email}" style="color:var(--acc);text-decoration:none">${l.email}</a>`:'<span style="color:var(--tx3)">—</span>';
  document.getElementById('chProfilePhone').innerHTML=l.phone?`<a href="tel:${l.phone}" style="color:var(--acc);text-decoration:none">${l.phone}</a>`:'<span style="color:var(--tx3)">—</span>';
  setEl('chProfileLastContact',l.last_contacted_at?fmtDate(l.last_contacted_at):'Never');
  document.querySelectorAll('#chProfileTabs .cd-tab').forEach(t=>t.classList.toggle('active',t.dataset.cdtab==='fields'));
  document.getElementById('chProfileFieldsTab').style.display='block';
  document.getElementById('chProfileActionsTab').style.display='none';

  chLoadActivities(id);
  chUpdateComposerTo();
  chLoadDraft();
}

function chUpdateComposerTo(){
  const el=document.getElementById('chComposerTo');if(!el)return;
  const l=allLeads.find(x=>x.id===chActiveLeadId);
  if(!l){el.textContent='—';return;}
  if(chActiveChannel==='sms')el.textContent=l.phone||'No phone number on file';
  else if(chActiveChannel==='email')el.textContent=l.email||'No email on file';
  else el.textContent=chLeadName(l)+(l.company_name?' · '+l.company_name:'');
}

function chLoadActivities(leadId){
  const feed=document.getElementById('chTimelineFeed');
  const badge=document.getElementById('chActivityStatusBadge');
  const summary=document.getElementById('chActivitySummary');
  feed.innerHTML='<div class="ch-timeline-empty"><span class="mat spin" style="font-size:33px;opacity:.5">sync</span><p style="font-size:13.5px">Loading activity…</p></div>';
  fetch(API.getActivities+'?lead_id='+leadId,{headers:chAuthHeaders()})
    .then(r=>{if(!r.ok)throw new Error('not configured');return r.json();})
    .then(data=>{
      chActivities=(Array.isArray(data)?data:[]).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      badge.textContent='Connected';badge.className='badge gr';
      summary.innerHTML=`<p style="font-size:12px;color:var(--tx2)">${chActivities.length} activit${chActivities.length===1?'y':'ies'} — calls, SMS, emails and notes for this lead.</p>`;
      chRenderTimeline(chFilterByTab(chActivities,chActiveTab));
    })
    .catch(()=>{
      badge.textContent='Not connected';badge.className='badge gy';
      summary.innerHTML='<p style="font-size:12px;color:var(--tx3)">Connect the get-lead-activities webhook to pull calls, SMS, emails and notes here automatically.</p>';
      const l=allLeads.find(x=>x.id===leadId);
      feed.innerHTML=`<div class="ch-timeline-empty"><span class="mat" style="font-size:33px;opacity:.35">history</span><p style="font-size:13.5px">No activity loaded yet for ${l?chLeadName(l):'this lead'}.</p></div>`;
    });
}

function chDayLabel(d){
  const dt=new Date(d),today=new Date(),yest=new Date();yest.setDate(today.getDate()-1);
  if(dt.toDateString()===today.toDateString())return'Today';
  if(dt.toDateString()===yest.toDateString())return'Yesterday';
  return dt.toLocaleDateString(undefined,{month:'short',day:'numeric',year:dt.getFullYear()!==today.getFullYear()?'numeric':undefined});
}
function chRenderTimeline(items){
  const feed = document.getElementById('chTimelineFeed');

  if(!items.length){
    feed.innerHTML = `
      <div class="ch-timeline-empty">
        <span class="mat" style="font-size:33px;opacity:.35">history</span>
        <p style="font-size:13.5px">No activity yet for this contact.</p>
      </div>
    `;
    return;
  }

  const sorted = items.slice().sort(
    (a,b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );

  let html = '';
  let lastDay = '';

  sorted.forEach(a => {

    const type = String(a.activity_type || '').toLowerCase();
    const data = a.activity_data || {};
    const dir = String(data.direction || '').toLowerCase();

    const day = a.created_at
      ? new Date(a.created_at).toDateString()
      : '';

    if(day && day !== lastDay){
      html += `
        <div class="ch-day-divider">
          <span>
            <span class="mat sm" style="font-size:13px">event</span>
            ${chDayLabel(a.created_at)}
          </span>
        </div>
      `;

      lastDay = day;
    }

    const time = a.created_at
      ? new Date(a.created_at).toLocaleTimeString([],{
          hour:'numeric',
          minute:'2-digit'
        })
      : '';

    const isMsg = type === 'sms' || type === 'email';

    if(isMsg){

      const outbound = dir !== 'inbound';

      const message =
        data.body ??
        data.message ??
        a.body ??
        a.message ??
        a.notes ??
        '';

      html += `
        <div class="ch-bubble-row${outbound ? ' out' : ''}">
          <div class="ch-bubble">

            <div class="ch-bubble-kicker">
              <span class="mat">
                ${type === 'sms' ? 'sms' : 'mail'}
              </span>

              ${type.toUpperCase()}
              ${dir ? ' · ' + escapeHtml(dir) : ''}
            </div>

            <div>
              ${message
                ? escapeHtml(message)
                : '<span style="color:var(--tx3)">No content recorded</span>'
              }
            </div>

            <div class="ch-bubble-time">
              ${time}
            </div>

          </div>
        </div>
      `;

    }else{

      const meta = chActivityMeta(a.activity_type);

      html += `
        <div class="ch-day-divider">
          <span class="badge ${meta.color}">
            <span class="mat sm">${meta.icon}</span>
            ${escapeHtml(a.activity_type || 'Activity')}
            ${dir ? ' · ' + escapeHtml(dir) : ''}
            ${a.notes ? ' — ' + escapeHtml(a.notes) : ''}
            · ${time}
          </span>
        </div>
      `;
    }
  });

  feed.innerHTML = html;

  // عند فتح المحادثة انزل لآخر رسالة
  feed.scrollTop = feed.scrollHeight;
}
async function chSendMessage(){
  const body=document.getElementById('chComposerBody');
  if(!body.value.trim()){toast('Write a message first','err');return;}
  if(!chActiveLeadId){toast('Select a lead first','err');return;}
  const lead=allLeads.find(l=>l.id===chActiveLeadId);
  if(chActiveChannel==='sms'&&!(lead&&lead.phone)){toast('This lead has no phone number on file','err');return;}
  if(chActiveChannel==='email'&&!(lead&&lead.email)){toast('This lead has no email on file','err');return;}
  const btn=document.getElementById('chComposerSendBtn');
  btn.disabled=true;
  try{
    let res;
    if(chActiveChannel==='note'){
      // Notes are internal-only — just another crm.activities row via lead-management, no external sync.
      res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add_note',id:chActiveLeadId,note:body.value.trim()})});
    }else{
      const endpoint=chActiveChannel==='email'?API.sendEmail:API.sendSms;
      const payload = {
  lead_id: chActiveLeadId,
  channel: chActiveChannel,
  body: body.value.trim(),
  to: chActiveChannel === 'sms'
      ? lead.phone
      : lead.email
};
      res=await fetch(endpoint,{method:'POST',headers:chAuthHeaders(),body:JSON.stringify(payload)});
    }
    if(!res.ok)throw new Error('not configured');
    toast(chActiveChannel==='note'?'Note saved':'Message sent');
    localStorage.removeItem(chDraftKey(chActiveLeadId,chActiveChannel));
    body.value='';
    chLoadActivities(chActiveLeadId);
  }catch(e){
    const who=chActiveChannel==='note'?'The add_note action on lead-management':chActiveChannel==='email'?'The Gmail-send workflow':'The SMS-send workflow';
    toast(who+' is not configured yet — ask an admin to set it up in n8n','err');
  }finally{btn.disabled=false;}
}
/* ------------------------------------------------------------
   Call bar controller — the bridge between VoiceService (provider-
   agnostic) and the Communication Hub DOM. This is the ONLY place
   that reads VoiceService.state and touches #chActiveCallBar.

   NOTE: API.logCall (upclose-start-call) is left defined in API
   above and untouched server-side — it's the legacy Close-backed
   dial endpoint. The Call button no longer calls it directly now
   that UPCLOSE owns the call experience via VoiceService; it stays
   available for any legacy/admin flow that still needs it.
   ------------------------------------------------------------ */
let chCallTimerHandle=null;
function chStartCall(lead,number){
  if(!number){toast('No phone number to call','err');return;}
  VoiceService.placeCall(lead,number);
}

function chCallBarName(lead,number){
  return lead?chLeadName(lead):number;
}

function chFormatDuration(sec){
  const m=Math.floor(sec/60).toString().padStart(2,'0');
  const s=Math.floor(sec%60).toString().padStart(2,'0');
  return m+':'+s;
}

function chUpdateCallBarUI(evt){
  const bar=document.getElementById('chActiveCallBar');
  const nameEl=document.getElementById('chActiveCallName');
  const statusEl=document.getElementById('chActiveCallStatus');
  const timerEl=document.getElementById('chActiveCallTimer');

  bar.classList.remove('st-connecting','st-ringing','st-active','st-failed');
  clearInterval(chCallTimerHandle);

  if(evt.state===CallState.IDLE){
    bar.hidden=true;
    return;
  }

  bar.hidden=false;
  nameEl.textContent=chCallBarName(evt.lead,evt.number)||'—';

  if(evt.state===CallState.CONNECTING){
    bar.classList.add('st-connecting');
    statusEl.innerHTML='Connecting…';
  }else if(evt.state===CallState.RINGING){
    bar.classList.add('st-ringing');
    statusEl.innerHTML='Ringing…';
  }else if(evt.state===CallState.ACTIVE){
    bar.classList.add('st-active');
    VoiceService.startedAt=VoiceService.startedAt||Date.now();
    timerEl.textContent='00:00';
    statusEl.innerHTML='Live call · <span id="chActiveCallTimer">00:00</span>';
    chCallTimerHandle=setInterval(()=>{
      const el=document.getElementById('chActiveCallTimer');
      if(el)el.textContent=chFormatDuration((Date.now()-VoiceService.startedAt)/1000);
    },1000);
  }else if(evt.state===CallState.FAILED){
    bar.classList.add('st-failed');
    statusEl.textContent=evt.reason||'Call failed';
    toast(evt.reason||'Call failed','err');
    setTimeout(()=>{if(VoiceService.state===CallState.FAILED){VoiceService.state=CallState.IDLE;bar.hidden=true;}},3500);
  }else if(evt.state===CallState.ENDED){
    bar.hidden=true;
    document.getElementById('chMuteBtn').classList.remove('active');
    document.getElementById('chHoldBtn').classList.remove('active');
  }
}
VoiceService.on('statechange',chUpdateCallBarUI);


/* Incoming call banner — shell only, not wired to any provider event yet
   (see VoiceService comment above). Kept here so an inbound integration
   only has to call chShowIncomingCall(); no further UI work needed. */
function chShowIncomingCall(caller){
  document.getElementById('chIncomingName').textContent=caller||'Unknown caller';
  document.getElementById('chIncomingBanner').classList.add('show');
}
function chDismissIncomingCall(){
  document.getElementById('chIncomingBanner').classList.remove('show');
}

function renderCommunicationHub(){
  chUpdateCounts();
  chRenderContactList(chFilteredLeads(chCurrentView()));
  chSwitchSubPage(chSubPage,false);
}


/* ================================================================
   COMMUNICATION HUB SUB-PAGE ROUTER
   ----------------------------------------------------------------
   Overview / Conversations / Calls / Tasks & Follow-ups / Snippets
   are full-width views over the SAME allLeads/chActivities data the
   original single-screen Communication Hub already used. Nothing
   here introduces a second leads/activities/tasks system — see the
   comments on each subpage's HTML block for exactly what's reused.

   State is kept client-side (localStorage) rather than in the URL
   hash, so it survives switching away and back to Communication Hub
   in the same session without touching the existing page router
   (navigate()/pageFromHash()/VALID_PAGES).
   ================================================================ */
const CH_SUBPAGE_KEY='upclose_ch_subpage_v1';
const CH_SUBPAGES=['conversations','manual','snippets','trigger'];
let chSubPage=CH_SUBPAGES.includes(localStorage.getItem(CH_SUBPAGE_KEY))?localStorage.getItem(CH_SUBPAGE_KEY):'conversations';
let chTaskView='overdue';
let chCallsFilter='scheduled';
let chManualView='overdue';

function chSwitchSubPage(sub,persist=true){
  if(!CH_SUBPAGES.includes(sub))sub='conversations';
  chSubPage=sub;
  if(persist)localStorage.setItem(CH_SUBPAGE_KEY,sub);
  document.querySelectorAll('#chSubNav .ch-subnav-item').forEach(i=>i.classList.toggle('active',i.dataset.sub===sub));
  CH_SUBPAGES.forEach(s=>{
    const el=document.getElementById('chSub-'+s);
    if(el)el.style.display=(s===sub)?(s==='conversations'?'flex':'block'):'none';
  });
  if(sub==='manual')chRenderManualActions();
  else if(sub==='snippets')chRenderSnippets();
  else if(sub==='trigger')chRenderTriggerLinks();
}

/* Jump into Conversations with a specific lead pre-selected — used by
   Overview rows, Calls rows, and Tasks rows so nothing there needs its
   own copy of the timeline/composer UI. */
function chOpenInConversations(leadId){
  chSwitchSubPage('conversations');
  chSelectLead(leadId);
}

/* ---- OVERVIEW ---- */
function chOvRow(l,metaText){
  const name=chLeadName(l);
  return `<div class="ch-ov-row" onclick="chOpenInConversations(${l.id})">
    <div class="av sm ${scClass(l.status||'Potential')}">${initials(l.company_name||name)}</div>
    <div style="flex:1;min-width:0">
      <div class="ch-ov-row-name">${name}</div>
      <div class="ch-ov-row-sub">${l.company_name||'—'}</div>
    </div>
    <div class="ch-ov-row-meta">${metaText}</div>
  </div>`;
}
function chOvFill(id,list,metaFn,emptyMsg){
  const el=document.getElementById(id);if(!el)return;
  if(!list.length){el.innerHTML=`<div class="ch-ov-empty">${emptyMsg}</div>`;return;}
  el.innerHTML=list.slice(0,25).map(l=>chOvRow(l,metaFn(l))).join('');
}
function chRenderOverview(){
  if(!Array.isArray(allLeads)||!allLeads.length){
    ['chOvAttention','chOvOverdue','chOvDueToday','chOvMine','chOvScheduled','chOvUnanswered','chOvRecent'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.innerHTML='<div class="ch-ov-empty">No leads loaded yet.</div>';
    });
    return;
  }
  const now=new Date(),todayStr=now.toISOString().slice(0,10);

  const attention=allLeads.filter(chNeedsAttention);
  chOvFill('chOvAttention',attention,l=>l.next_followup_at?fmtDate(l.next_followup_at):'No contact',
    'Nothing needs urgent attention right now.');
  setEl('chOvCountAttention',attention.length);

  const overdue=allLeads.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now&&l.status==='Potential');
  chOvFill('chOvOverdue',overdue.sort((a,b)=>new Date(a.next_followup_at)-new Date(b.next_followup_at)),
    l=>fmtDate(l.next_followup_at),'No overdue follow-ups. Nice.');
  setEl('chOvCountOverdue',overdue.length);

  const dueToday=allLeads.filter(l=>l.next_followup_at&&l.next_followup_at.slice(0,10)===todayStr&&l.status==='Potential');
  chOvFill('chOvDueToday',dueToday,l=>fmtTime((l.next_followup_at||'').slice(11,16))||fmtDate(l.next_followup_at),
    'No follow-ups due today.');
  setEl('chOvCountDueToday',dueToday.length);

  const mine=allLeads.filter(l=>l.status==='Potential'&&chIsMine(l));
  chOvFill('chOvMine',mine,l=>l.pipeline_stage||defaultStage(l),'You have no open leads assigned.');
  setEl('chOvCountMine',mine.length);

  const scheduled=allLeads.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr);
  chOvFill('chOvScheduled',scheduled.sort((a,b)=>(a.preferred_time||'').localeCompare(b.preferred_time||'')),
    l=>l.preferred_time?fmtTime(l.preferred_time):'—','Nothing scheduled for today.');
  setEl('chOvCountScheduled',scheduled.length);

  const unanswered=allLeads.filter(l=>!l.last_contacted_at&&l.status==='Potential');
  chOvFill('chOvUnanswered',unanswered,l=>l.created_at?fmtDate(l.created_at):'—','Every open lead has been contacted at least once.');
  setEl('chOvCountUnanswered',unanswered.length);

  const recent=allLeads.filter(l=>l.last_contacted_at).sort((a,b)=>new Date(b.last_contacted_at)-new Date(a.last_contacted_at));
  chOvFill('chOvRecent',recent,l=>fmtDate(l.last_contacted_at),'No contact activity recorded yet.');
  setEl('chOvCountRecent',recent.length);
}

/* ---- CALLS ---- */
function chRenderCallsPage(){
  const wrap=document.getElementById('chCallsScheduledList');if(!wrap)return;
  const todayStr=new Date().toISOString().slice(0,10);
  const list=(allLeads||[]).filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr)
    .sort((a,b)=>(a.preferred_time||'').localeCompare(b.preferred_time||''));
  if(!list.length){wrap.innerHTML='<div class="ch-ov-empty">No leads have a call/meeting scheduled for today.</div>';return;}
  wrap.innerHTML=list.map(l=>{
    const name=chLeadName(l);
    return `<div class="ch-calls-row">
      <div class="av sm ${scClass(l.status||'Potential')}">${initials(l.company_name||name)}</div>
      <div style="flex:1;min-width:0">
        <div class="ch-ov-row-name">${name}</div>
        <div class="ch-ov-row-sub">${l.company_name||'—'}${l.phone?' · '+l.phone:''}</div>
      </div>
      <div class="ch-ov-row-meta">${l.preferred_time?fmtTime(l.preferred_time):'—'}</div>
      <button class="tbb" title="Call" ${l.phone?'':'disabled style="opacity:.35;cursor:not-allowed"'} onclick="event.stopPropagation();chCallLeadById(${l.id})"><span class="mat">call</span></button>
      <button class="tbb" title="Open in Conversations" onclick="chOpenInConversations(${l.id})"><span class="mat">open_in_new</span></button>
    </div>`;
  }).join('');
}

/* ---- TASKS & FOLLOW-UPS ---- */
function chRenderTasksPage(){
  const body=document.getElementById('chTasksTableBody');if(!body)return;
  const now=new Date();
  let rows=[];
  if(chTaskView==='completed'){
    body.innerHTML=`<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--tx3);font-size:13px">
      There's no persisted "task completed" state on the backend yet — follow-ups here are derived live from each
      lead's Next Follow-Up date, not a separate task record. Once a real tasks table exists this view will show
      completed items honestly instead of guessing.</td></tr>`;
    return;
  }
  const potential=(allLeads||[]).filter(l=>l.status==='Potential'&&l.next_followup_at);
  if(chTaskView==='overdue')rows=potential.filter(l=>new Date(l.next_followup_at)<now);
  else if(chTaskView==='today')rows=potential.filter(l=>l.next_followup_at.slice(0,10)===now.toISOString().slice(0,10));
  else if(chTaskView==='upcoming')rows=potential.filter(l=>new Date(l.next_followup_at)>now&&l.next_followup_at.slice(0,10)!==now.toISOString().slice(0,10));
  rows=rows.sort((a,b)=>new Date(a.next_followup_at)-new Date(b.next_followup_at));
  if(!rows.length){
    body.innerHTML=`<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--tx3);font-size:13px">No follow-ups in this view.</td></tr>`;
    return;
  }
  body.innerHTML=rows.map(l=>{
    const name=chLeadName(l);
    return `<tr>
      <td style="font-weight:600">${name}</td>
      <td>${l.company_name||'—'}</td>
      <td>${fmtDate(l.next_followup_at)}</td>
      <td><span class="badge bl">Follow-up</span></td>
      <td>
        <button class="tbb" title="Call" ${l.phone?'':'disabled style="opacity:.35;cursor:not-allowed"'} onclick="chCallLeadById(${l.id})"><span class="mat">call</span></button>
        <button class="tbb" title="Open Conversation" onclick="chOpenInConversations(${l.id})"><span class="mat">forum</span></button>
        <button class="tbb" title="Open Lead" onclick="openLead(${l.id})"><span class="mat">open_in_new</span></button>
      </td>
    </tr>`;
  }).join('');
}
function chCallLeadById(id){
  const l=allLeads.find(x=>x.id===id);
  if(!l||!l.phone){toast('No phone number on file for this lead','err');return;}
  chStartCall(l,l.phone);
}

/* ---- MANUAL ACTIONS ----
   Replaces the old Overview/Calls/Tasks subpages with one table view.
   Every row is a real Potential lead pulled from allLeads — nothing here
   is a separate "action queue" table. */
function chManualRows(view){
  const now=new Date(),todayStr=now.toISOString().slice(0,10);
  const potential=(allLeads||[]).filter(l=>l.status==='Potential');
  if(view==='overdue')return potential.filter(l=>l.next_followup_at&&new Date(l.next_followup_at)<now).sort((a,b)=>new Date(a.next_followup_at)-new Date(b.next_followup_at));
  if(view==='today')return potential.filter(l=>l.next_followup_at&&l.next_followup_at.slice(0,10)===todayStr).sort((a,b)=>(a.next_followup_at||'').localeCompare(b.next_followup_at||''));
  if(view==='calls')return potential.filter(l=>l.preferred_date&&l.preferred_date.slice(0,10)===todayStr).sort((a,b)=>(a.preferred_time||'').localeCompare(b.preferred_time||''));
  if(view==='unanswered')return potential.filter(l=>!l.last_contacted_at).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  return[];
}
function chManualDateLabel(l,view){
  if(view==='calls')return l.preferred_time?fmtTime(l.preferred_time):fmtDate(l.preferred_date);
  if(view==='unanswered')return l.created_at?fmtDate(l.created_at):'—';
  return l.next_followup_at?fmtDate(l.next_followup_at):'—';
}
function chManualStatusBadge(view){
  const m={overdue:'<span class="badge re">Overdue</span>',today:'<span class="badge am">Due Today</span>',calls:'<span class="badge bl">Scheduled</span>',unanswered:'<span class="badge gy">No Contact</span>'};
  return m[view]||'<span class="badge gy">—</span>';
}
async function chMarkContacted(id,notify=true){
  try{
    const res=await fetch(API.leadManagement,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_lead',id:parseInt(id),last_contacted_at:new Date().toISOString()})});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const idx=allLeads.findIndex(l=>l.id===id);
    if(idx>-1)allLeads[idx].last_contacted_at=new Date().toISOString();
    if(notify){
      toast('✓ Marked as contacted','ok');
      chRenderManualActions();chUpdateCounts();chRenderContactList(chFilteredLeads(chCurrentView()));
    }
    return true;
  }catch(e){
    if(notify)toast('Failed to update — try again','err');
    return false;
  }
}
async function chManualBulkMarkContacted(){
  const ids=[...document.querySelectorAll('#chManualTableBody .ch-row-check:checked')].map(cb=>parseInt(cb.dataset.id));
  if(!ids.length)return;
  const btn=document.getElementById('chManualBulkMarkBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<span class="mat sm spin">sync</span>Updating…';}
  const results=await Promise.all(ids.map(id=>chMarkContacted(id,false)));
  const okCount=results.filter(Boolean).length;
  toast(okCount===ids.length?`✓ Marked ${okCount} as contacted`:`Marked ${okCount} of ${ids.length} — some failed`,okCount===ids.length?'ok':'err');
  chRenderManualActions();chUpdateCounts();chRenderContactList(chFilteredLeads(chCurrentView()));
}
function chManualUpdateBulkBar(){
  const bar=document.getElementById('chManualBulkBar');if(!bar)return;
  const checked=document.querySelectorAll('#chManualTableBody .ch-row-check:checked').length;
  bar.style.display=checked?'flex':'none';
  setEl('chManualBulkCount',checked+' selected');
  const selectAll=document.getElementById('chManualSelectAll');
  const total=document.querySelectorAll('#chManualTableBody .ch-row-check').length;
  if(selectAll)selectAll.checked=total>0&&checked===total;
}
function chRenderManualActions(){
  const body=document.getElementById('chManualTableBody');if(!body)return;
  const rows=chManualRows(chManualView);
  const selectAll=document.getElementById('chManualSelectAll');if(selectAll)selectAll.checked=false;
  chManualUpdateBulkBar();
  if(!rows.length){body.innerHTML='<tr><td colspan="7" style="padding:26px;text-align:center;color:var(--tx3);font-size:13px">Nothing in this view. Nice.</td></tr>';return;}
  body.innerHTML=rows.map(l=>{
    const name=chLeadName(l);
    return`<tr>
      <td><input type="checkbox" class="ch-row-check" data-id="${l.id}" style="accent-color:var(--acc)"/></td>
      <td><div style="display:flex;align-items:center;gap:9px"><div class="av ${scClass(l.status||'Potential')}">${initials(l.company_name||name)}</div><span style="font-weight:600">${name}</span></div></td>
      <td>${l.company_name||'—'}</td>
      <td>${l.phone?'Call':'—'}</td>
      <td>${chManualStatusBadge(chManualView)}</td>
      <td>${chManualDateLabel(l,chManualView)}</td>
      <td>
        <button class="tbb" title="Call" ${l.phone?'':'disabled style="opacity:.35;cursor:not-allowed"'} onclick="chCallLeadById(${l.id})"><span class="mat">call</span></button>
        <button class="tbb" title="Open Conversation" onclick="chOpenInConversations(${l.id})"><span class="mat">forum</span></button>
        <button class="tbb" title="Mark Contacted" onclick="chMarkContacted(${l.id})"><span class="mat">task_alt</span></button>
      </td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.ch-row-check').forEach(cb=>cb.addEventListener('change',chManualUpdateBulkBar));
}

/* ---- SNIPPETS ----
   Local-only storage (see comment on the HTML block above). Shape:
   { id, name, content, channel: 'sms'|'email'|'any', created_at } */
const CH_SNIPPETS_KEY='upclose_snippets_v1';
function chLoadSnippets(){try{return JSON.parse(localStorage.getItem(CH_SNIPPETS_KEY)||'[]');}catch(e){return[];}}
function chSaveSnippets(list){localStorage.setItem(CH_SNIPPETS_KEY,JSON.stringify(list));}
function chSnippetsUpdateBulkBar(){
  const bar=document.getElementById('chSnippetsBulkBar');if(!bar)return;
  const checked=document.querySelectorAll('#chSnippetsTableBody .ch-row-check:checked').length;
  bar.style.display=checked?'flex':'none';
  setEl('chSnippetsBulkCount',checked+' selected');
  const selectAll=document.getElementById('chSnippetsSelectAll');
  const total=document.querySelectorAll('#chSnippetsTableBody .ch-row-check').length;
  if(selectAll)selectAll.checked=total>0&&checked===total;
}
function chSnippetsBulkDelete(){
  const ids=[...document.querySelectorAll('#chSnippetsTableBody .ch-row-check:checked')].map(cb=>cb.dataset.id);
  if(!ids.length)return;
  if(!confirm(`Delete ${ids.length} snippet(s)? This can't be undone.`))return;
  chSaveSnippets(chLoadSnippets().filter(s=>!ids.includes(s.id)));
  chRenderSnippets();
  toast(`Deleted ${ids.length} snippet(s)`);
}
function chRenderSnippets(){
  const body=document.getElementById('chSnippetsTableBody');if(!body)return;
  const searchEl=document.getElementById('chSnippetsSearch');
  const q=(searchEl?searchEl.value:'').toLowerCase();
  let list=chLoadSnippets();
  if(q)list=list.filter(s=>s.name.toLowerCase().includes(q)||s.content.toLowerCase().includes(q));
  const selectAll=document.getElementById('chSnippetsSelectAll');if(selectAll)selectAll.checked=false;
  chSnippetsUpdateBulkBar();
  if(!list.length){body.innerHTML='<tr><td colspan="6" style="padding:26px;text-align:center;color:var(--tx3);font-size:13px">No snippets yet. Create one to reuse it from the Conversations composer.</td></tr>';return;}
  body.innerHTML=list.map(s=>`<tr>
    <td><input type="checkbox" class="ch-row-check" data-id="${s.id}" style="accent-color:var(--acc)"/></td>
    <td style="font-weight:600">${escapeHtml(s.name)}</td>
    <td style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2)">${escapeHtml(s.content)}</td>
    <td>${s.channel==='sms'?'SMS':s.channel==='email'?'Email':'Text'}</td>
    <td>${fmtDate(s.created_at)}</td>
    <td>
      <button class="tbb" title="Use in Conversations" onclick="chInsertSnippet('${s.id}')"><span class="mat">forum</span></button>
      <button class="tbb" title="Edit" onclick="chOpenSnippetEditor('${s.id}')"><span class="mat">edit</span></button>
      <button class="tbb" title="Delete" onclick="chDeleteSnippet('${s.id}')"><span class="mat">delete</span></button>
    </td>
  </tr>`).join('');
  body.querySelectorAll('.ch-row-check').forEach(cb=>cb.addEventListener('change',chSnippetsUpdateBulkBar));
}
function chOpenSnippetEditor(id){
  const list=chLoadSnippets();
  const existing=id?list.find(s=>s.id===id):null;
  const name=prompt('Snippet name',existing?existing.name:'');
  if(name===null)return;
  const content=prompt('Snippet text',existing?existing.content:'');
  if(content===null)return;
  if(!name.trim()||!content.trim()){toast('Name and text are both required','err');return;}
  if(existing){existing.name=name.trim();existing.content=content.trim();}
  else list.push({id:'sn_'+Date.now(),name:name.trim(),content:content.trim(),channel:'any',created_at:new Date().toISOString()});
  chSaveSnippets(list);
  chRenderSnippets();
  toast('Snippet saved');
}
function chDeleteSnippet(id){
  chSaveSnippets(chLoadSnippets().filter(s=>s.id!==id));
  chRenderSnippets();
}
function chInsertSnippet(id){
  const s=chLoadSnippets().find(x=>x.id===id);if(!s)return;
  chSwitchSubPage('conversations');
  const body=document.getElementById('chComposerBody');
  if(!chActiveLeadId){toast('Select a lead in Conversations, then insert the snippet','err');return;}
  body.value=(body.value?body.value+'\n':'')+s.content;
  body.focus();
}

function chRenderSnippetQuickList(){
  const pop=document.getElementById('chSnippetQuickList');if(!pop)return;
  const list=chLoadSnippets();
  if(!list.length){pop.innerHTML='<div class="ch-snip-pop-empty">No snippets saved yet — <a onclick="chToggleSnippetQuickList();chSwitchSubPage(\'snippets\')">create one →</a></div>';return;}
  pop.innerHTML=list.map(s=>`<div class="ch-snip-pop-item" onclick="chInsertSnippet('${s.id}');chToggleSnippetQuickList()"><b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.content.slice(0,64))}</span></div>`).join('');
}
function chToggleSnippetQuickList(force){
  const pop=document.getElementById('chSnippetQuickList');if(!pop)return;
  const opening=typeof force==='boolean'?force:!pop.classList.contains('open');
  pop.classList.toggle('open',opening);
  if(opening)chRenderSnippetQuickList();
}

/* ---- TRIGGER LINKS ----
   Local-only storage, same pattern as Snippets above: there is no
   click-tracking backend yet, so links + keys are generated and kept
   in this browser only. The "Analyze" tab is an honest empty state,
   not fabricated click counts. */
const CH_TRIGGER_KEY='upclose_trigger_links_v1';
function chLoadTriggerLinks(){try{return JSON.parse(localStorage.getItem(CH_TRIGGER_KEY)||'[]');}catch(e){return[];}}
function chSaveTriggerLinksList(list){localStorage.setItem(CH_TRIGGER_KEY,JSON.stringify(list));}
function chGenTriggerKey(){return'trigger_link.'+Math.random().toString(36).slice(2,14);}
function chRenderTriggerLinks(){
  const body=document.getElementById('chTriggerTableBody');if(!body)return;
  const searchEl=document.getElementById('chTriggerSearch');
  const q=(searchEl?searchEl.value:'').toLowerCase();
  let list=chLoadTriggerLinks();
  if(q)list=list.filter(t=>t.name.toLowerCase().includes(q)||t.url.toLowerCase().includes(q));
  if(!list.length){body.innerHTML='<tr><td colspan="5" style="padding:26px;text-align:center;color:var(--tx3);font-size:13px">No trigger links yet. Add one to track clicks inside your messages.</td></tr>';return;}
  body.innerHTML=list.map(t=>`<tr>
    <td style="font-weight:600">${escapeHtml(t.name)}</td>
    <td><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="color:var(--acc);text-decoration:none">${escapeHtml(t.url)}</a></td>
    <td style="font-family:monospace;font-size:12px;color:var(--tx2);white-space:nowrap">{{${t.key}}} <button class="tbb" title="Copy" style="width:22px;height:22px;display:inline-flex;vertical-align:middle" onclick="chCopyTriggerKey('${t.key}')"><span class="mat sm">content_copy</span></button></td>
    <td>${fmtDate(t.created_at)}</td>
    <td><button class="tbb" title="Delete" onclick="chDeleteTriggerLink('${t.id}')"><span class="mat">delete</span></button></td>
  </tr>`).join('');
}
function chOpenTriggerLinkEditor(){
  const name=prompt('Link name');
  if(name===null)return;
  const url=prompt('Destination URL (https://…)');
  if(url===null)return;
  if(!name.trim()||!url.trim()){toast('Name and URL are both required','err');return;}
  const list=chLoadTriggerLinks();
  list.push({id:'tl_'+Date.now(),name:name.trim(),url:url.trim(),key:chGenTriggerKey(),created_at:new Date().toISOString()});
  chSaveTriggerLinksList(list);
  chRenderTriggerLinks();
  toast('Trigger link added');
}
function chDeleteTriggerLink(id){
  chSaveTriggerLinksList(chLoadTriggerLinks().filter(t=>t.id!==id));
  chRenderTriggerLinks();
}
function chCopyTriggerKey(key){
  const text='{{'+key+'}}';
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>toast('Copied')).catch(()=>toast('Copy failed','err'));}
  else toast('Copy not supported in this browser','err');
}

/* Global Quick Dial popover — lives in the topbar, usable from any page */
const qdToggle=document.getElementById('quickDialToggle');
const qdPanel=document.getElementById('quickDialPanel');
qdToggle.addEventListener('click',e=>{e.stopPropagation();qdPanel.classList.toggle('open');if(qdPanel.classList.contains('open'))document.getElementById('dialpadNumber').focus();});
document.addEventListener('click',e=>{if(qdPanel.classList.contains('open')&&!qdPanel.contains(e.target)&&e.target!==qdToggle)qdPanel.classList.remove('open');});
document.querySelectorAll('.ch-dialkey').forEach(k=>{
  k.addEventListener('click',()=>{
    // During an active call the same keypad sends DTMF tones instead of
    // building a number to dial — that's what "Keypad" on the call bar opens.
    if(VoiceService.state===CallState.ACTIVE){
      VoiceService.sendDigit(k.dataset.d);
      return;
    }
    document.getElementById('dialpadNumber').value+=k.dataset.d;
  });
});
document.getElementById('dialpadCallBtn').addEventListener('click',()=>{
  const input=document.getElementById('dialpadNumber');
  const n=input.value.trim();
  if(!n){toast('Enter a number first','err');return;}
  const lead=allLeads.find(l=>l.phone===n)||(chActiveLeadId?allLeads.find(l=>l.id===chActiveLeadId):null);
  chStartCall(lead,n);
  input.value='';
  qdPanel.classList.remove('open');
});

document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmdPal();}
  if(e.key==='Escape'){if(document.getElementById('modal').classList.contains('open')){closeModal();return;}if(document.getElementById('confirmDialog').classList.contains('open')){confirmCancel();return;}if(document.getElementById('userMenu').classList.contains('open')){closeUserMenu();return;}const cfp=document.getElementById('clientsFiltersPopover');if(cfp&&cfp.classList.contains('open')){closeFiltersPopover();return;}if(document.getElementById('recPanel').classList.contains('lp-open')){closeRecPanel();return;}closeCmdPal();closeLeadPanel();}
  if(e.key==='l'&&!e.metaKey&&!e.ctrlKey&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA')openCreateLead();
});
/* ================================================================
   AUTOMATIONS MODULE
   ----------------------------------------------------------------
   Frontend-only UI + data model for the UpClose Automation Builder.

   IMPORTANT — HONESTY NOTES:
   - There is no backend automation engine yet. Nothing here calls
     n8n, Twilio, email, or any execution endpoint.
   - "Activate Automation" only flips the local `status` field to
     'active' in the stored AutomationDefinition — it does NOT start
     any real server-side automation. Once real Automation API
     endpoints exist, autoActivate() is the single place to swap in
     a real POST /api/automations/:id/activate call (see TODO below).
   - Automation definitions are persisted to localStorage
     ('upclose_automations_v1') purely so a user's in-progress
     builder work survives a page reload. This is NOT the same as
     PostgreSQL persistence — it is a client-side draft cache that
     will be replaced by real API calls (see report section 11).
   - Runs / executions are never fabricated. The list always shows
     "—" for Runs because no execution engine exists yet.
   ================================================================ */

const AUTO_STORE_KEY = 'upclose_automations_v1';
let autoAutomations = [];      // in-memory list, mirrors localStorage
let autoStatusFilter = 'all';
let autoCurrent = null;        // AutomationDefinition currently open in the builder
let autoPickerCtx = null;      // {mode:'trigger'} | {mode:'stepkind', ...} | {mode:'action', ...}
let autoConfigCtx = null;      // describes what autoConfigSave() should do

// ---- Catalogs (mirrors the spec's trigger/condition/action lists) ----
const AUTO_TRIGGERS = [
  { cat:'Leads', items:[
    { type:'lead_created', label:'Lead Created', icon:'person_add' },
    { type:'lead_status_changed', label:'Lead Status Changed', icon:'sync_alt' },
    { type:'pipeline_stage_changed', label:'Pipeline Stage Changed', icon:'view_kanban' },
    { type:'lead_assigned', label:'Lead Assigned', icon:'assignment_ind' },
    { type:'lead_updated', label:'Lead Updated', icon:'edit_note' },
  ]},
  { cat:'Communication', items:[
    { type:'call_completed', label:'Call Completed', icon:'call' },
    { type:'sms_received', label:'SMS Received', icon:'sms' },
    { type:'sms_sent', label:'SMS Sent', icon:'forward_to_inbox' },
    { type:'email_received', label:'Email Received', icon:'mail' },
    { type:'email_sent', label:'Email Sent', icon:'send' },
  ]},
  { cat:'Meetings', items:[
    { type:'meeting_booked', label:'Meeting Booked', icon:'event_available' },
    { type:'meeting_cancelled', label:'Meeting Cancelled', icon:'event_busy' },
    { type:'meeting_completed', label:'Meeting Completed', icon:'task_alt' },
  ]},
  { cat:'Forms', items:[
    { type:'form_submitted', label:'Form Submitted', icon:'assignment_turned_in' },
  ]},
];

const AUTO_COND_FIELDS = [
  { key:'lead_status', label:'Lead Status' },
  { key:'pipeline_stage', label:'Pipeline Stage' },
  { key:'lead_source', label:'Lead Source' },
  { key:'owner', label:'Owner' },
  { key:'phone', label:'Phone' },
  { key:'email', label:'Email' },
  { key:'deal_value', label:'Deal Value' },
  { key:'call_status', label:'Call Status' },
  { key:'call_duration', label:'Call Duration' },
  { key:'meeting_status', label:'Meeting Status' },
];

const AUTO_OPERATORS = [
  { key:'equals', label:'equals' },
  { key:'not_equals', label:'does not equal' },
  { key:'contains', label:'contains' },
  { key:'not_contains', label:'does not contain' },
  { key:'greater_than', label:'greater than' },
  { key:'less_than', label:'less than' },
  { key:'exists', label:'exists' },
  { key:'not_exists', label:'does not exist' },
];

const AUTO_ACTIONS = [
  { cat:'CRM', items:[
    { action:'assign_owner', label:'Assign Owner', icon:'assignment_ind' },
    { action:'change_lead_status', label:'Change Lead Status', icon:'sync_alt' },
    { action:'change_pipeline_stage', label:'Change Pipeline Stage', icon:'view_kanban' },
    { action:'add_note', label:'Add Note', icon:'sticky_note_2' },
    { action:'create_task', label:'Create Task', icon:'task' },
    { action:'update_lead_field', label:'Update Lead Field', icon:'edit_note' },
  ]},
  { cat:'Communication', items:[
    { action:'send_sms', label:'Send SMS', icon:'sms' },
    { action:'send_email', label:'Send Email', icon:'mail' },
  ]},
  { cat:'Voice', items:[
    { action:'create_call_task', label:'Create Call Task', icon:'call' },
  ]},
  { cat:'Meetings', items:[
    { action:'create_meeting_task', label:'Create Meeting / Booking Task', icon:'event' },
  ]},
  { cat:'Reputation', items:[
    { action:'send_review_request', label:'Send Review Request', icon:'reviews' },
  ]},
  { cat:'Flow', items:[
    { action:'stop_automation', label:'Stop Automation', icon:'block' },
  ]},
];

function autoFlatTriggers(){ return AUTO_TRIGGERS.flatMap(c=>c.items); }
function autoFlatActions(){ return AUTO_ACTIONS.flatMap(c=>c.items); }
function autoTriggerMeta(type){ return autoFlatTriggers().find(t=>t.type===type) || null; }
function autoActionMeta(action){ return autoFlatActions().find(a=>a.action===action) || null; }
function autoFieldLabel(key){ const f=AUTO_COND_FIELDS.find(f=>f.key===key); return f?f.label:key; }
function autoOpLabel(key){ const o=AUTO_OPERATORS.find(o=>o.key===key); return o?o.label:key; }
function autoId(prefix){ return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function autoFmtDateTime(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d.getTime())) return '—'; return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+' · '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }

// ---- Persistence (localStorage draft cache — see honesty note above) ----
function autoLoadStore(){
  try{
    const raw = localStorage.getItem(AUTO_STORE_KEY);
    autoAutomations = raw ? JSON.parse(raw) : [];
  }catch(e){ console.error('Automations: failed to read local draft store', e); autoAutomations = []; }
}
function autoSaveStore(){
  try{ localStorage.setItem(AUTO_STORE_KEY, JSON.stringify(autoAutomations)); }
  catch(e){ console.error('Automations: failed to persist local draft store', e); }
}

// ---- List view ----
function autoShowList(){
  if(!autoAutomations.length && localStorage.getItem(AUTO_STORE_KEY)===null){ autoLoadStore(); }
  else if(!autoAutomations || autoAutomations===undefined){ autoLoadStore(); }
  document.getElementById('autoListView').style.display='';
  document.getElementById('autoBuilderView').style.display='none';
  autoRenderList();
}

function autoSetStatusFilter(val, el){
  autoStatusFilter = val;
  document.querySelectorAll('#autoStatusFilterGroup .topt').forEach(x=>x.classList.remove('active'));
  if(el) el.classList.add('active');
  autoRenderList();
}

function autoRenderList(){
  const tbody = document.getElementById('autoListTable');
  if(!tbody) return;
  const q = (document.getElementById('autoSearchInput')?.value||'').trim().toLowerCase();
  let list = autoAutomations.slice().sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0));
  if(autoStatusFilter!=='all') list = list.filter(a=>a.status===autoStatusFilter);
  if(q) list = list.filter(a=>(a.name||'').toLowerCase().includes(q));

  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <span class="mat">bolt</span>
      <p>${autoAutomations.length? 'No automations match your filters.' : 'No automations yet. Automate lead follow-up, assignment, and outreach without leaving UpClose.'}</p>
      <button class="abtn pri" onclick="autoOpenBuilder(null)"><span class="mat sm">add</span>Create Automation</button>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a=>{
    const trig = autoTriggerMeta(a.trigger && a.trigger.type);
    const trigHtml = trig
      ? `<span class="auto-trigger-chip"><span class="mat">${trig.icon}</span>${escapeHtml(trig.label)}</span>`
      : `<span style="color:var(--tx3);font-size:12.5px">No trigger set</span>`;
    const statusLbl = a.status.charAt(0).toUpperCase()+a.status.slice(1);
    return `<tr>
      <td><div class="auto-name-cell">${escapeHtml(a.name||'Untitled Automation')}</div>${a.description?`<div style="font-size:12px;color:var(--tx3);margin-top:2px">${escapeHtml(a.description)}</div>`:''}</td>
      <td>${trigHtml}</td>
      <td><span class="badge st-${a.status}">${statusLbl}</span></td>
      <td style="font-size:13px;color:var(--tx2)">${autoFmtDateTime(a.updated_at)}</td>
      <td style="font-size:13px;color:var(--tx3)">—</td>
      <td>
        <div class="auto-actions-menu-wrap">
          <button class="tbb" onclick="autoToggleRowMenu(event,'${a.id}')"><span class="mat">more_vert</span></button>
          <div class="auto-actions-menu" id="autoRowMenu-${a.id}">
            <div class="ami" onclick="autoCloseRowMenus();autoOpenBuilder('${a.id}')"><span class="mat sm">edit</span>Edit</div>
            <div class="ami" onclick="autoCloseRowMenus();autoDuplicate('${a.id}')"><span class="mat sm">content_copy</span>Duplicate</div>
            ${a.status==='active'
              ? `<div class="ami" onclick="autoCloseRowMenus();autoSetStatus('${a.id}','paused')"><span class="mat sm">pause</span>Pause</div>`
              : `<div class="ami" onclick="autoCloseRowMenus();autoSetStatus('${a.id}','active')"><span class="mat sm">play_arrow</span>Activate</div>`}
            <div class="ami danger" onclick="autoCloseRowMenus();autoDelete('${a.id}')"><span class="mat sm">delete</span>Delete</div>
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function autoToggleRowMenu(ev, id){
  ev.stopPropagation();
  const wasOpen = document.getElementById('autoRowMenu-'+id)?.classList.contains('open');
  autoCloseRowMenus();
  if(!wasOpen){ const m=document.getElementById('autoRowMenu-'+id); if(m) m.classList.add('open'); }
}
function autoCloseRowMenus(){ document.querySelectorAll('.auto-actions-menu.open').forEach(m=>m.classList.remove('open')); }
document.addEventListener('click', ()=>autoCloseRowMenus());

function autoSetStatus(id, status){
  const a = autoAutomations.find(x=>x.id===id); if(!a) return;
  a.status = status; a.updated_at = new Date().toISOString();
  autoSaveStore(); autoRenderList();
}
function autoDuplicate(id){
  const a = autoAutomations.find(x=>x.id===id); if(!a) return;
  const copy = JSON.parse(JSON.stringify(a));
  copy.id = autoId('auto');
  copy.name = a.name + ' (Copy)';
  copy.status = 'draft';
  copy.created_at = new Date().toISOString();
  copy.updated_at = copy.created_at;
  autoAutomations.push(copy);
  autoSaveStore(); autoRenderList();
}
function autoDelete(id){
  const a = autoAutomations.find(x=>x.id===id); if(!a) return;
  const doDelete = ()=>{ autoAutomations = autoAutomations.filter(x=>x.id!==id); autoSaveStore(); autoRenderList(); };
  if(typeof showConfirm==='function'){
    showConfirm(`Delete "${a.name}"?`, 'This automation will be permanently removed.', 'Delete', 'danger', doDelete);
  } else {
    doDelete();
  }
}

// ---- Builder view ----
function autoBlankDefinition(){
  const now = new Date().toISOString();
  return { id:null, name:'New Automation', description:'', status:'draft', trigger:{ type:null, config:{} }, steps:[], created_at:now, updated_at:now };
}

function autoOpenBuilder(id){
  if(id){
    const found = autoAutomations.find(a=>a.id===id);
    autoCurrent = found ? JSON.parse(JSON.stringify(found)) : autoBlankDefinition();
  } else {
    autoCurrent = autoBlankDefinition();
  }
  document.getElementById('autoListView').style.display='none';
  const bv = document.getElementById('autoBuilderView'); bv.style.display='flex';
  document.getElementById('autoBuilderNameInput').value = autoCurrent.name;
  document.getElementById('autoBuilderStatusBadge').className = 'badge st-'+autoCurrent.status;
  document.getElementById('autoBuilderStatusBadge').textContent = autoCurrent.status.charAt(0).toUpperCase()+autoCurrent.status.slice(1);
  document.getElementById('autoActivateBtnLbl').textContent = autoCurrent.status==='active' ? 'Deactivate Automation' : 'Activate Automation';
  autoRenderFlow();
}

function autoBackToList(){
  autoCurrent = null;
  autoShowList();
}

function autoOnNameInput(){
  if(!autoCurrent) return;
  autoCurrent.name = document.getElementById('autoBuilderNameInput').value || 'New Automation';
}

function autoPersistCurrent(newStatus){
  if(!autoCurrent) return;
  if(!autoCurrent.name) autoCurrent.name = 'New Automation';
  if(newStatus) autoCurrent.status = newStatus;
  autoCurrent.updated_at = new Date().toISOString();
  if(!autoCurrent.id){
    autoCurrent.id = autoId('auto');
    autoAutomations.push(autoCurrent);
  } else {
    const idx = autoAutomations.findIndex(a=>a.id===autoCurrent.id);
    if(idx>=0) autoAutomations[idx] = autoCurrent; else autoAutomations.push(autoCurrent);
  }
  autoSaveStore();
}

function autoSaveDraft(){
  autoPersistCurrent(autoCurrent.status==='active' ? 'active' : 'draft');
  autoToast('Draft saved');
  document.getElementById('autoBuilderStatusBadge').className = 'badge st-'+autoCurrent.status;
  document.getElementById('autoBuilderStatusBadge').textContent = autoCurrent.status.charAt(0).toUpperCase()+autoCurrent.status.slice(1);
}

function autoActivate(){
  if(!autoCurrent.trigger || !autoCurrent.trigger.type){
    autoToast('Add a trigger before activating this automation.');
    return;
  }
  // TODO(backend): once POST /api/automations exists, call it here and only
  // flip local status to 'active' after a successful server response.
  // For now this only updates the local AutomationDefinition — no server-side
  // automation is actually running.
  const next = autoCurrent.status==='active' ? 'draft' : 'active';
  autoPersistCurrent(next);
  document.getElementById('autoBuilderStatusBadge').className = 'badge st-'+autoCurrent.status;
  document.getElementById('autoBuilderStatusBadge').textContent = autoCurrent.status.charAt(0).toUpperCase()+autoCurrent.status.slice(1);
  document.getElementById('autoActivateBtnLbl').textContent = autoCurrent.status==='active' ? 'Deactivate Automation' : 'Activate Automation';
  autoToast(next==='active' ? 'Marked as Active (frontend state only — no execution engine connected yet)' : 'Marked as Draft');
}

function autoToast(msg){
  if(typeof toast==='function') toast(msg);
  else console.log('[Automations]', msg);
}

// ---- Flow canvas rendering ----
function autoRenderFlow(){
  const wrap = document.getElementById('autoFlowCanvas');
  if(!wrap || !autoCurrent) return;
  let html = '';

  // Trigger card
  const trig = autoTriggerMeta(autoCurrent.trigger.type);
  html += `<div class="auto-step-card" onclick="autoEditTrigger()" style="cursor:pointer">
    <div class="auto-step-icon trig"><span class="mat">${trig?trig.icon:'bolt'}</span></div>
    <div style="min-width:0;flex:1">
      <div class="auto-step-kicker">When</div>
      <div class="auto-step-title">${trig?escapeHtml(trig.label):'Choose a trigger…'}</div>
      <div class="auto-step-sub">${trig?'This automation starts here':'Click to select what starts this automation'}</div>
    </div>
    <div class="auto-step-acts"><button class="tbb" title="Change trigger"><span class="mat sm">edit</span></button></div>
  </div>`;

  autoCurrent.steps.forEach((step, i)=>{
    html += `<div class="auto-connector"></div>`;
    html += autoRenderStep(step, i, false);
  });

  html += `<div class="auto-connector"></div>`;
  html += `<div class="auto-add-step-btn" onclick="autoOpenStepKindPicker(null,false)"><span class="mat sm">add</span>Add Step</div>`;

  wrap.innerHTML = html;
}

function autoRenderStep(step, index, insideBranch){
  const delBtn = `<button class="tbb" title="Remove step" onclick="event.stopPropagation();autoRemoveStep(${index}${insideBranch?`,'${insideBranch}'`:''})"><span class="mat sm">delete</span></button>`;
  const editAttr = `onclick="autoEditStep(${index}${insideBranch?`,'${insideBranch}'`:''})"`;

  if(step.type==='wait'){
    const cfg = step.config||{};
    return `<div class="auto-step-card" style="cursor:pointer" ${editAttr}>
      <div class="auto-step-icon wait"><span class="mat">schedule</span></div>
      <div style="min-width:0;flex:1">
        <div class="auto-step-kicker">Wait</div>
        <div class="auto-step-title">Wait ${cfg.value||'—'} ${cfg.unit||''}</div>
        <div class="auto-step-sub">Pauses the automation before continuing</div>
      </div>
      <div class="auto-step-acts">${delBtn}</div>
    </div>`;
  }

  if(step.type==='action'){
    const meta = autoActionMeta(step.action);
    return `<div class="auto-step-card" style="cursor:pointer" ${editAttr}>
      <div class="auto-step-icon act"><span class="mat">${meta?meta.icon:'bolt'}</span></div>
      <div style="min-width:0;flex:1">
        <div class="auto-step-kicker">Do</div>
        <div class="auto-step-title">${meta?escapeHtml(meta.label):'Action'}</div>
        <div class="auto-step-sub">${autoActionSummary(step)}</div>
      </div>
      <div class="auto-step-acts">${delBtn}</div>
    </div>`;
  }

  if(step.type==='condition'){
    let condHtml = `<div class="auto-step-card" style="cursor:pointer" ${editAttr}>
      <div class="auto-step-icon cond"><span class="mat">call_split</span></div>
      <div style="min-width:0;flex:1">
        <div class="auto-step-kicker">If</div>
        <div class="auto-step-title">${autoConditionSummary(step)}</div>
        <div class="auto-step-sub">${step.branch? 'Branches into Yes / No paths' : 'Only continues if this is true'}</div>
      </div>
      <div class="auto-step-acts">${delBtn}</div>
    </div>`;

    if(step.branch){
      condHtml += `<div class="auto-connector"></div>`;
      condHtml += `<div class="auto-branch-wrap">
        <div class="auto-branch-col">
          <div class="auto-branch-lbl yes">If Yes</div>
          ${(step.branch_yes||[]).map((s,j)=>`<div>${autoRenderStep(s, j, index+':yes')}</div>`).join('<div class="auto-connector" style="height:14px"></div>')}
          <div class="auto-add-step-btn" style="padding:8px" onclick="autoOpenStepKindPicker(${index},'yes')"><span class="mat sm">add</span>Add</div>
        </div>
        <div class="auto-branch-col">
          <div class="auto-branch-lbl no">If No</div>
          ${(step.branch_no||[]).map((s,j)=>`<div>${autoRenderStep(s, j, index+':no')}</div>`).join('<div class="auto-connector" style="height:14px"></div>')}
          <div class="auto-add-step-btn" style="padding:8px" onclick="autoOpenStepKindPicker(${index},'no')"><span class="mat sm">add</span>Add</div>
        </div>
      </div>`;
    }
    return condHtml;
  }
  return '';
}

function autoConditionSummary(step){
  let s = `${escapeHtml(autoFieldLabel(step.field))} ${escapeHtml(autoOpLabel(step.operator))}${step.value?' '+escapeHtml(step.value):''}`;
  if(step.logic && step.field2){
    s += ` ${step.logic} ${escapeHtml(autoFieldLabel(step.field2))} ${escapeHtml(autoOpLabel(step.operator2))}${step.value2?' '+escapeHtml(step.value2):''}`;
  }
  return s;
}

function autoActionSummary(step){
  const cfg = step.config||{};
  switch(step.action){
    case 'assign_owner': return cfg.owner_name ? `Assign to ${escapeHtml(cfg.owner_name)}` : 'Choose an owner…';
    case 'change_lead_status': return cfg.status ? `Set status to ${escapeHtml(cfg.status)}` : 'Choose a status…';
    case 'change_pipeline_stage': return cfg.stage ? `Move to stage: ${escapeHtml(cfg.stage)}` : 'Choose a stage…';
    case 'add_note': return cfg.note ? escapeHtml(cfg.note).slice(0,60) : 'Add a note to the lead';
    case 'create_task': return cfg.title ? `Task: ${escapeHtml(cfg.title)}` : 'Configure task…';
    case 'update_lead_field': return cfg.field ? `Set ${escapeHtml(cfg.field)} to ${escapeHtml(cfg.value||'')}` : 'Choose a field…';
    case 'send_sms': return cfg.template ? escapeHtml(cfg.template).slice(0,60) : 'Configure SMS message…';
    case 'send_email': return cfg.subject ? `Subject: ${escapeHtml(cfg.subject)}` : 'Configure email…';
    case 'create_call_task': return cfg.note ? escapeHtml(cfg.note).slice(0,60) : 'Create a call task for the owner';
    case 'create_meeting_task': return cfg.note ? escapeHtml(cfg.note).slice(0,60) : 'Create a meeting/booking task';
    case 'stop_automation': return 'Ends the automation here';
    default: return '';
  }
}

function autoRemoveStep(index, branchKey){
  if(branchKey){
    const [parentIdx, which] = branchKey.split(':');
    const parent = autoCurrent.steps[parentIdx];
    const arr = which==='yes' ? parent.branch_yes : parent.branch_no;
    arr.splice(index,1);
  } else {
    autoCurrent.steps.splice(index,1);
  }
  autoRenderFlow();
}

// ---- Trigger picker ----
function autoEditTrigger(){
  autoPickerCtx = { mode:'trigger' };
  document.getElementById('autoPickerModalTitle').textContent = 'Choose a Trigger';
  document.getElementById('autoPickerModalBody').innerHTML = `<div class="auto-picker-cats">${
    AUTO_TRIGGERS.map(cat=>`<div>
      <div class="auto-picker-cat-lbl">${escapeHtml(cat.cat)}</div>
      <div class="auto-picker-grid">${cat.items.map(t=>`<div class="auto-picker-item" onclick="autoPickTrigger('${t.type}')"><span class="mat">${t.icon}</span><span class="plbl">${escapeHtml(t.label)}</span></div>`).join('')}</div>
    </div>`).join('')
  }</div>`;
  document.getElementById('autoPickerModal').classList.add('open');
}
function autoPickTrigger(type){
  autoCurrent.trigger = { type, config:{} };
  autoClosePickerModal();
  autoRenderFlow();
}

// ---- Add-step picker (kind: condition / action / wait) ----
function autoOpenStepKindPicker(afterIndex, branchKey){
  autoPickerCtx = { mode:'stepkind', afterIndex, branchKey };
  document.getElementById('autoPickerModalTitle').textContent = 'Add a Step';
  document.getElementById('autoPickerModalBody').innerHTML = `<div class="auto-picker-grid">
    <div class="auto-picker-item" onclick="autoOpenActionPicker()"><span class="mat">bolt</span><span class="plbl">Action</span></div>
    <div class="auto-picker-item" onclick="autoAddWaitStep()"><span class="mat">schedule</span><span class="plbl">Wait / Delay</span></div>
    ${branchKey ? '' : `<div class="auto-picker-item" onclick="autoAddConditionStep()"><span class="mat">call_split</span><span class="plbl">Condition (If/Else)</span></div>`}
  </div>`;
  document.getElementById('autoPickerModal').classList.add('open');
}

function autoOpenActionPicker(){
  document.getElementById('autoPickerModalTitle').textContent = 'Choose an Action';
  document.getElementById('autoPickerModalBody').innerHTML = `<div class="auto-picker-cats">${
    AUTO_ACTIONS.map(cat=>`<div>
      <div class="auto-picker-cat-lbl">${escapeHtml(cat.cat)}</div>
      <div class="auto-picker-grid">${cat.items.map(a=>`<div class="auto-picker-item" onclick="autoAddActionStep('${a.action}')"><span class="mat">${a.icon}</span><span class="plbl">${escapeHtml(a.label)}</span></div>`).join('')}</div>
    </div>`).join('')
  }</div>`;
}

function autoInsertStep(step){
  const ctx = autoPickerCtx;
  if(ctx && ctx.branchKey){
    const parent = autoCurrent.steps[ctx.afterIndex];
    const arr = ctx.branchKey==='yes' ? (parent.branch_yes=parent.branch_yes||[]) : (parent.branch_no=parent.branch_no||[]);
    arr.push(step);
  } else {
    autoCurrent.steps.push(step);
  }
  autoClosePickerModal();
  autoRenderFlow();
}

function autoAddWaitStep(){
  autoInsertStep({ id:autoId('st'), type:'wait', config:{ value:10, unit:'minutes' } });
}
function autoAddConditionStep(){
  autoInsertStep({ id:autoId('st'), type:'condition', field:AUTO_COND_FIELDS[0].key, operator:'equals', value:'', branch:false, branch_yes:[], branch_no:[] });
}
function autoAddActionStep(action){
  autoInsertStep({ id:autoId('st'), type:'action', action, config:{} });
}

function autoClosePickerModal(){
  document.getElementById('autoPickerModal').classList.remove('open');
  autoPickerCtx = null;
}

// ---- Step editing (opens config modal for existing step) ----
function autoEditStep(index, branchKey){
  let step;
  if(branchKey){
    const [parentIdx, which] = branchKey.split(':');
    const parent = autoCurrent.steps[parentIdx];
    step = which==='yes' ? parent.branch_yes[index] : parent.branch_no[index];
  } else {
    step = autoCurrent.steps[index];
  }
  if(!step) return;
  autoConfigCtx = { index, branchKey, step };
  if(step.type==='wait') return autoOpenWaitConfig(step);
  if(step.type==='condition') return autoOpenConditionConfig(step);
  if(step.type==='action') return autoOpenActionConfig(step);
}

async function autoOpenActionConfig(step){
  const meta = autoActionMeta(step.action);
  document.getElementById('autoConfigModalTitle').textContent = meta ? meta.label : 'Configure Action';
  const cfg = step.config||{};
  let body = '';
  switch(step.action){
    case 'assign_owner':
      if(typeof ensureClosersLoaded==='function'){ try{ await ensureClosersLoaded(); }catch(e){} }
      const ownerOpts = Object.keys(closersMap||{}).map(id=>`<option value="${id}" ${cfg.owner_id===id?'selected':''}>${escapeHtml(closersMap[id])}</option>`).join('');
      body = `<div class="form-group"><label class="form-label">Owner</label><select class="form-select" id="acfgOwner"><option value="">Select a closer…</option>${ownerOpts}</select></div>`;
      break;
    case 'change_lead_status':
      body = `<div class="form-group"><label class="form-label">New Status</label><select class="form-select" id="acfgStatus">
        <option value="Potential" ${cfg.status==='Potential'?'selected':''}>Potential</option>
        <option value="Won" ${cfg.status==='Won'?'selected':''}>Won</option>
        <option value="Lost" ${cfg.status==='Lost'?'selected':''}>Lost</option>
      </select></div>`;
      break;
    case 'change_pipeline_stage':
      body = `<div class="form-group"><label class="form-label">Pipeline Stage</label><input class="form-input" id="acfgStage" placeholder="e.g. Demo Scheduled" value="${escapeHtml(cfg.stage||'')}"/></div>`;
      break;
    case 'add_note':
      body = `<div class="form-group full"><label class="form-label">Note</label><textarea class="form-textarea" id="acfgNote" placeholder="Internal note to add…">${escapeHtml(cfg.note||'')}</textarea></div>`;
      break;
    case 'create_task':
      body = `<div class="form-group full"><label class="form-label">Task Title</label><input class="form-input" id="acfgTitle" placeholder="Follow up with lead" value="${escapeHtml(cfg.title||'')}"/></div>
              <div class="form-group full"><label class="form-label">Notes</label><textarea class="form-textarea" id="acfgTaskNotes" placeholder="Optional details…">${escapeHtml(cfg.notes||'')}</textarea></div>`;
      break;
    case 'update_lead_field':
      body = `<div class="form-group"><label class="form-label">Field</label><select class="form-select" id="acfgField">
        <option value="source" ${cfg.field==='source'?'selected':''}>Source</option>
        <option value="company" ${cfg.field==='company'?'selected':''}>Company Name</option>
        <option value="phone" ${cfg.field==='phone'?'selected':''}>Phone</option>
        <option value="email" ${cfg.field==='email'?'selected':''}>Email</option>
      </select></div>
      <div class="form-group"><label class="form-label">New Value</label><input class="form-input" id="acfgValue" value="${escapeHtml(cfg.value||'')}"/></div>`;
      break;
    case 'send_sms':
      body = `<div class="form-group full"><label class="form-label">Message</label><textarea class="form-textarea" id="acfgTemplate" placeholder="Hi {{first_name}}, thanks for reaching out…">${escapeHtml(cfg.template||'')}</textarea></div>
              <div style="font-size:12px;color:var(--tx3)">This defines the message template only — sending happens server-side once the Automation Engine is connected.</div>`;
      break;
    case 'send_email':
      body = `<div class="form-group full"><label class="form-label">Subject</label><input class="form-input" id="acfgSubject" value="${escapeHtml(cfg.subject||'')}"/></div>
              <div class="form-group full"><label class="form-label">Body</label><textarea class="form-textarea" id="acfgBody" placeholder="Email body…">${escapeHtml(cfg.body||'')}</textarea></div>`;
      break;
    case 'create_call_task':
      body = `<div class="form-group full"><label class="form-label">Notes for the caller</label><textarea class="form-textarea" id="acfgCallNote" placeholder="Context for the call…">${escapeHtml(cfg.note||'')}</textarea></div>`;
      break;
    case 'create_meeting_task':
      body = `<div class="form-group full"><label class="form-label">Notes</label><textarea class="form-textarea" id="acfgMeetNote" placeholder="What needs to be scheduled…">${escapeHtml(cfg.note||'')}</textarea></div>`;
      break;
    case 'send_review_request':
      body = `<div class="form-group"><label class="form-label">Channel</label><select class="form-select" id="acfgReviewChannel">
        <option value="sms" ${!cfg.channel||cfg.channel==='sms'?'selected':''}>SMS</option>
      </select></div>
      <div style="font-size:12px;color:var(--tx3);margin-top:2px;line-height:1.6">No review URL is entered here. At run time the backend resolves it from the lead's client_id → that client's review configuration, so a customer can never receive another client's link.</div>`;
      break;
    case 'stop_automation':
      body = `<div style="font-size:13.5px;color:var(--tx2)">This step ends the automation here. No further steps below it will run for this branch.</div>`;
      break;
    default:
      body = `<div style="font-size:13.5px;color:var(--tx3)">No configuration needed.</div>`;
  }
  document.getElementById('autoConfigModalBody').innerHTML = `<div class="form-row">${body}</div>`;
  document.getElementById('autoConfigModal').classList.add('open');
}

function autoOpenWaitConfig(step){
  document.getElementById('autoConfigModalTitle').textContent = 'Wait / Delay';
  const cfg = step.config||{value:10,unit:'minutes'};
  document.getElementById('autoConfigModalBody').innerHTML = `
    <div class="auto-cond-row">
      <div class="form-group"><label class="form-label">Duration</label><input class="form-input" type="number" min="1" id="acfgWaitValue" value="${cfg.value||10}"/></div>
      <div class="form-group"><label class="form-label">Unit</label><select class="form-select" id="acfgWaitUnit">
        <option value="minutes" ${cfg.unit==='minutes'?'selected':''}>Minutes</option>
        <option value="hours" ${cfg.unit==='hours'?'selected':''}>Hours</option>
        <option value="days" ${cfg.unit==='days'?'selected':''}>Days</option>
      </select></div>
    </div>`;
  document.getElementById('autoConfigModal').classList.add('open');
}

function autoOpenConditionConfig(step){
  document.getElementById('autoConfigModalTitle').textContent = 'Condition';
  const fieldOpts = f => AUTO_COND_FIELDS.map(c=>`<option value="${c.key}" ${step[f]===c.key?'selected':''}>${escapeHtml(c.label)}</option>`).join('');
  const opOpts = f => AUTO_OPERATORS.map(o=>`<option value="${o.key}" ${step[f]===o.key?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
  document.getElementById('autoConfigModalBody').innerHTML = `
    <div class="auto-cond-row">
      <div class="form-group"><label class="form-label">Field</label><select class="form-select" id="acfgCondField">${fieldOpts('field')}</select></div>
      <div class="form-group"><label class="form-label">Operator</label><select class="form-select" id="acfgCondOp">${opOpts('operator')}</select></div>
      <div class="form-group"><label class="form-label">Value</label><input class="form-input" id="acfgCondValue" value="${escapeHtml(step.value||'')}"/></div>
    </div>
    <div style="margin-top:6px">
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--tx2);cursor:pointer">
        <input type="checkbox" id="acfgCondAddSecond" ${step.field2?'checked':''} onchange="document.getElementById('acfgSecondRow').style.display=this.checked?'flex':'none'"/>
        Add a second condition
      </label>
    </div>
    <div class="auto-cond-row" id="acfgSecondRow" style="display:${step.field2?'flex':'none'};margin-top:8px">
      <div class="form-group" style="max-width:100px"><label class="form-label">Logic</label><select class="form-select" id="acfgCondLogic">
        <option value="AND" ${step.logic==='AND'?'selected':''}>AND</option>
        <option value="OR" ${step.logic==='OR'?'selected':''}>OR</option>
      </select></div>
      <div class="form-group"><label class="form-label">Field</label><select class="form-select" id="acfgCondField2">${fieldOpts('field2')}</select></div>
      <div class="form-group"><label class="form-label">Operator</label><select class="form-select" id="acfgCondOp2">${opOpts('operator2')}</select></div>
      <div class="form-group"><label class="form-label">Value</label><input class="form-input" id="acfgCondValue2" value="${escapeHtml(step.value2||'')}"/></div>
    </div>
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)">
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--tx2);cursor:pointer">
        <input type="checkbox" id="acfgCondBranch" ${step.branch?'checked':''}/>
        Branch into separate "If Yes" / "If No" paths
      </label>
    </div>`;
  document.getElementById('autoConfigModal').classList.add('open');
}

function autoCloseConfigModal(){
  document.getElementById('autoConfigModal').classList.remove('open');
  autoConfigCtx = null;
}

function autoConfigSave(){
  if(!autoConfigCtx) return;
  const step = autoConfigCtx.step;

  if(step.type==='wait'){
    const v = parseInt(document.getElementById('acfgWaitValue').value, 10);
    step.config = { value: (isNaN(v)||v<1) ? 1 : v, unit: document.getElementById('acfgWaitUnit').value };
  }

  if(step.type==='condition'){
    step.field = document.getElementById('acfgCondField').value;
    step.operator = document.getElementById('acfgCondOp').value;
    step.value = document.getElementById('acfgCondValue').value;
    const addSecond = document.getElementById('acfgCondAddSecond').checked;
    if(addSecond){
      step.logic = document.getElementById('acfgCondLogic').value;
      step.field2 = document.getElementById('acfgCondField2').value;
      step.operator2 = document.getElementById('acfgCondOp2').value;
      step.value2 = document.getElementById('acfgCondValue2').value;
    } else {
      delete step.logic; delete step.field2; delete step.operator2; delete step.value2;
    }
    step.branch = document.getElementById('acfgCondBranch').checked;
    if(step.branch){ step.branch_yes = step.branch_yes||[]; step.branch_no = step.branch_no||[]; }
  }

  if(step.type==='action'){
    step.config = step.config||{};
    switch(step.action){
      case 'assign_owner': {
        const sel = document.getElementById('acfgOwner');
        step.config.owner_id = sel.value;
        step.config.owner_name = sel.options[sel.selectedIndex]?.text || '';
        break;
      }
      case 'change_lead_status': step.config.status = document.getElementById('acfgStatus').value; break;
      case 'change_pipeline_stage': step.config.stage = document.getElementById('acfgStage').value; break;
      case 'add_note': step.config.note = document.getElementById('acfgNote').value; break;
      case 'create_task':
        step.config.title = document.getElementById('acfgTitle').value;
        step.config.notes = document.getElementById('acfgTaskNotes').value;
        break;
      case 'update_lead_field':
        step.config.field = document.getElementById('acfgField').value;
        step.config.value = document.getElementById('acfgValue').value;
        break;
      case 'send_sms': step.config.template = document.getElementById('acfgTemplate').value; break;
      case 'send_email':
        step.config.subject = document.getElementById('acfgSubject').value;
        step.config.body = document.getElementById('acfgBody').value;
        break;
      case 'create_call_task': step.config.note = document.getElementById('acfgCallNote').value; break;
      case 'create_meeting_task': step.config.note = document.getElementById('acfgMeetNote').value; break;
      case 'send_review_request': step.config.channel = document.getElementById('acfgReviewChannel').value; break;
      default: break;
    }
  }

  autoCloseConfigModal();
  autoRenderFlow();
}

/* ================================================================
   REVIEWS / REPUTATION MODULE
   ----------------------------------------------------------------
   Frontend-only UI + data model for Google Review requests, per the
   architecture in the spec:

     UPCLOSE Lead/Customer -> Client Review Configuration ->
     Send Review Request -> Twilio SMS -> reviews.upleaddigital.com/
     {client-slug} -> Google Review

   IMPORTANT — HONESTY NOTES:
   - There is no backend Review Request API yet (API.sendReviewRequest
     points at a webhook that does not exist). sendReviewRequestFromModal()
     makes a REAL fetch() call to it — it is not simulated. Until that
     endpoint is deployed, the call will fail and the UI reports that
     honestly; nothing is ever marked "sent" locally.
   - Client review configuration (review_url / google_review_url /
     enabled) is persisted to localStorage ('upclose_review_configs_v1')
     purely as a frontend draft cache, exactly like the Automations
     module's local store. This is NOT PostgreSQL persistence — see the
     report for the recommended `client_review_config` table.
   - "Recent Review Requests" and the KPI row never fabricate numbers.
     They read from the existing Activity Timeline endpoint
     (API.leadManagement / action:get_activities) filtered to
     activity_type === 'review_request'. Until a backend actually
     writes those events, the UI shows an honest "Not connected" /
     empty state — never a fake count.
   - CLIENT SAFETY: review_url is always resolved through client_id
     (lead.client_id / client.lead_id in this dataset), never taken
     from ad-hoc frontend input at send time. The composer displays the
     resolved client's URL for transparency, but the actual send
     request only carries lead_id + client_id — the backend must be the
     one to look up and inject the URL. A customer of Client A must
     never be able to receive Client B's link.
   ================================================================ */

const REVIEW_CONFIG_STORE_KEY = 'upclose_review_configs_v1';
let reviewConfigs = {};        // { [client_id]: {review_url, google_review_url, enabled} }
let reviewComposerCtx = null;  // {leadId, clientId, phone} for the open composer
const REV_TEMPLATES_KEY='upclose_review_templates_v1';
let revActivitiesCache=null;   // real review_request activities from the last successful fetch, reused by KPIs + client table + feed
function revLoadTemplates(){
  try{
    const list=JSON.parse(localStorage.getItem(REV_TEMPLATES_KEY)||'[]');
    if(list.length)return list;
  }catch(e){}
  const seeded=[{id:'rt_default',name:'Default',content:revDefaultTemplate(),created_at:new Date().toISOString()}];
  localStorage.setItem(REV_TEMPLATES_KEY,JSON.stringify(seeded));
  return seeded;
}
function revSaveTemplates(list){localStorage.setItem(REV_TEMPLATES_KEY,JSON.stringify(list));}
function revOpenTemplateEditor(id){
  const list=revLoadTemplates();
  const existing=id?list.find(t=>t.id===id):null;
  const name=prompt('Template name',existing?existing.name:'');
  if(name===null)return;
  const content=prompt('Message (use {{first_name}}, {{business_name}}, {{review_url}})',existing?existing.content:revDefaultTemplate());
  if(content===null)return;
  if(!name.trim()||!content.trim()){toast('Name and message are both required','err');return;}
  if(existing){existing.name=name.trim();existing.content=content.trim();}
  else list.push({id:'rt_'+Date.now(),name:name.trim(),content:content.trim(),created_at:new Date().toISOString()});
  revSaveTemplates(list);
  revRenderTemplatesTable();
  toast('Template saved');
}
function revDeleteTemplate(id){
  const list=revLoadTemplates().filter(t=>t.id!==id);
  if(!list.length){toast('You need at least one template','err');return;}
  revSaveTemplates(list);
  revRenderTemplatesTable();
}
function revRenderTemplatesTable(){
  const body=document.getElementById('revTemplatesTableBody');if(!body)return;
  const list=revLoadTemplates();
  body.innerHTML=list.map(t=>`<tr>
    <td style="font-weight:600">${escapeHtml(t.name)}</td>
    <td style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2);font-size:12.5px">${escapeHtml(t.content)}</td>
    <td>${fmtDate(t.created_at)}</td>
    <td>
      <button class="tbb" title="Edit" onclick="revOpenTemplateEditor('${t.id}')"><span class="mat">edit</span></button>
      <button class="tbb" title="Delete" onclick="revDeleteTemplate('${t.id}')"><span class="mat">delete</span></button>
    </td>
  </tr>`).join('');
}

// ---- Persistence (localStorage draft cache — see honesty note above) ----
function revLoadConfigs(){
  try{
    reviewConfigs = JSON.parse(localStorage.getItem(REVIEW_CONFIG_STORE_KEY) || '{}');
  }catch(e){ console.error('Reviews: failed to read local config store', e); reviewConfigs = {}; }
}
function revSaveConfigs(){
  try{ localStorage.setItem(REVIEW_CONFIG_STORE_KEY, JSON.stringify(reviewConfigs)); }
  catch(e){ console.error('Reviews: failed to persist local config store', e); }
}
function revGetConfig(clientId){ return reviewConfigs[String(clientId)] || null; }
function revSetConfig(clientId, cfg){ reviewConfigs[String(clientId)] = {...cfg}; revSaveConfigs(); }

// ---- Message template (kept intentionally simple, per spec §4) ----
function revDefaultTemplate(){
  return "Hi {{first_name}}, thanks for visiting {{business_name}}.\n\nWe'd appreciate your feedback:\n\n{{review_url}}";
}
function revRenderTemplate(tpl, vars){
  return String(tpl || '')
    .replace(/{{\s*first_name\s*}}/gi, vars.first_name || '')
    .replace(/{{\s*last_name\s*}}/gi, vars.last_name || '')
    .replace(/{{\s*business_name\s*}}/gi, vars.business_name || '')
    .replace(/{{\s*review_url\s*}}/gi, vars.review_url || '');
}

// ---- Reviews page ----
async function renderReviewsPage(){
  revLoadConfigs();
  revRenderTemplatesTable();
  await revLoadRequestsFeed();
  renderReviewClientConfigTable();
  revRenderReadyToRequest();
}

function renderReviewOverviewKpis(items){
  const el = document.getElementById('revKpiRow'); if(!el) return;
  if(!items){
    el.innerHTML = `
      <div class="stat-card c-acc"><div class="mlbl">Requests Sent</div><div class="kpi-val-lg">—</div><div class="kpi-sub">Connect the Review Request API</div></div>
      <div class="stat-card c-gr"><div class="mlbl">Delivered</div><div class="kpi-val-lg">—</div><div class="kpi-sub">Requires Twilio delivery webhook</div></div>
      <div class="stat-card c-bl"><div class="mlbl">Link Clicks</div><div class="kpi-val-lg">—</div><div class="kpi-sub">Requires click tracking on redirect</div></div>
      <div class="stat-card c-am"><div class="mlbl">Google Redirects</div><div class="kpi-val-lg">—</div><div class="kpi-sub">Requires redirect tracking</div></div>`;
    return;
  }
  const total=items.length;
  const cutoff=Date.now()-30*86400000;
  const last30=items.filter(a=>new Date(a.created_at).getTime()>=cutoff).length;
  const byStatus=id=>items.filter(a=>((a.activity_data&&a.activity_data.status)||'pending')===id).length;
  el.innerHTML = `
    <div class="stat-card c-acc"><div class="mlbl">Requests Sent</div><div class="kpi-val-lg">${total}</div><div class="kpi-sub">${last30} in the last 30 days</div></div>
    <div class="stat-card c-gr"><div class="mlbl">Delivered</div><div class="kpi-val-lg">${byStatus('delivered')}</div><div class="kpi-sub">of ${total} total requests</div></div>
    <div class="stat-card c-re"><div class="mlbl">Failed</div><div class="kpi-val-lg">${byStatus('failed')}</div><div class="kpi-sub">delivery failures</div></div>
    <div class="stat-card c-bl"><div class="mlbl">Link Clicks</div><div class="kpi-val-lg">—</div><div class="kpi-sub">Requires click tracking on redirect</div></div>`;
}

function renderReviewClientConfigTable(){
  const tbody = document.getElementById('revClientConfigTable'); if(!tbody) return;
  if(!allClients.length){
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><span class="mat">verified_user</span><p>No clients yet. Convert a lead to a client to configure review settings.</p><button class="abtn pri" onclick="navigate('opportunities')"><span class="mat sm">people</span>View Leads</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML = allClients.map(c=>{
    const cfg = revGetConfig(c.id) || {};
    const hasUrl = !!cfg.review_url;
    const enabled = hasUrl && cfg.enabled !== false;
    const statusLabel = !hasUrl ? 'Not configured' : (enabled ? 'Enabled' : 'Disabled');
    const statusCls = !hasUrl ? 'gy' : (enabled ? 'gr' : 'am');
    const sentCount = (revActivitiesCache && revActivitiesHaveClientId) ? revActivitiesCache.filter(a=>String(a.client_id)===String(c.id)).length : null;
    return `<tr>
      <td style="font-weight:600">${escapeHtml(c.company_name || '—')}</td>
      <td style="font-family:monospace;font-size:12.5px;color:${hasUrl?'var(--tx2)':'var(--tx3)'}">${hasUrl?escapeHtml(cfg.review_url):'—'}</td>
      <td style="font-family:monospace;font-size:12.5px;color:${cfg.google_review_url?'var(--tx2)':'var(--tx3)'}">${cfg.google_review_url?escapeHtml(cfg.google_review_url):'—'}</td>
      <td>${sentCount===null?'<span style="color:var(--tx3)">—</span>':sentCount}</td>
      <td><span class="badge ${statusCls}">${statusLabel}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="abtn" style="padding:4px 10px;font-size:12px" onclick="openReviewConfigEditor(${c.id})"><span class="mat sm">edit</span>Configure</button>
        ${hasUrl?`<button class="abtn" style="padding:4px 10px;font-size:12px" onclick="revShowQr(${c.id})"><span class="mat sm">qr_code_2</span>QR</button>`:''}
        ${hasUrl?`<button class="abtn" style="padding:4px 10px;font-size:12px" onclick="openReviewRequestModal(null,${c.id})"><span class="mat sm">send</span>Request</button>`:''}
      </td>
    </tr>`;
  }).join('');
}
function revShowQr(clientId){
  const cfg=revGetConfig(clientId);
  if(!cfg||!cfg.review_url){toast('Configure a review URL for this client first','err');return;}
  const url='https://api.qrserver.com/v1/create-qr-code/?size=320x320&data='+encodeURIComponent(cfg.review_url);
  window.open(url,'_blank','noopener');
}

// ---- "Ready to Request" — real eligible CUSTOMERS (leads), not clients.
// A client is the business being reviewed, never the recipient. Eligibility
// is: a Won lead, with a phone number, whose client_id points to a client
// that has review requests enabled. Staleness is measured per lead_id,
// since each customer is asked individually. ----
function revRenderReadyToRequest(){
  const el=document.getElementById('revReadyList');if(!el)return;

  const hasLeadClientLink = allLeads.some(l=>l.client_id!=null);
  if(!hasLeadClientLink){
    el.innerHTML='<div class="empty-state"><span class="mat">link_off</span><p>Customers aren\'t linked to their client yet (lead.client_id is missing from the leads feed). Once that\'s wired up, eligible customers will be listed here automatically.</p></div>';
    return;
  }

  const enabledClientIds=new Set(allClients.filter(c=>{
    const cfg=revGetConfig(c.id);
    return cfg&&cfg.review_url&&cfg.enabled!==false;
  }).map(c=>c.id));
  if(!enabledClientIds.size){
    el.innerHTML='<div class="empty-state"><span class="mat">verified_user</span><p>No clients are configured and enabled yet. Set one up under Client Review Configuration below.</p></div>';
    return;
  }

  const eligible=allLeads.filter(l=>l.status==='Won'&&l.phone&&enabledClientIds.has(l.client_id));
  if(!eligible.length){
    el.innerHTML='<div class="empty-state"><span class="mat">verified_user</span><p>No won customers with a phone number are linked to a configured, enabled client yet.</p></div>';
    return;
  }

  const clientName=id=>{const c=allClients.find(x=>x.id===id);return c?(c.company_name||'—'):'—';};

  if(!revActivitiesCache||!revActivitiesHaveLeadId){
    el.innerHTML=eligible.slice(0,50).map(l=>`<div class="arow"><div class="activity-icon bl"><span class="mat sm">person</span></div><div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:600;color:var(--tx)">${escapeHtml(chLeadName(l))}</div>
      <div style="font-size:11px;color:var(--tx3);margin-top:2px">${escapeHtml(clientName(l.client_id))} — last-requested date isn't available yet</div>
    </div><button class="abtn" style="padding:4px 10px;font-size:12px" onclick="openReviewRequestModal(${l.id},${l.client_id})"><span class="mat sm">send</span>Request</button></div>`).join('');
    return;
  }

  const cutoff=Date.now()-14*86400000;
  const withLast=eligible.map(l=>{
    const requests=revActivitiesCache.filter(a=>String(a.lead_id)===String(l.id));
    const last=requests.length?Math.max(...requests.map(a=>new Date(a.created_at).getTime())):null;
    return{lead:l,last};
  });
  const stale=withLast.filter(x=>x.last===null||x.last<cutoff);
  if(!stale.length){
    el.innerHTML='<div class="empty-state"><span class="mat">task_alt</span><p>Every eligible customer has been asked for a review in the last 14 days.</p></div>';
    return;
  }
  stale.sort((a,b)=>(a.last||0)-(b.last||0));
  el.innerHTML=stale.slice(0,50).map(x=>`<div class="arow"><div class="activity-icon am"><span class="mat sm">person</span></div><div style="flex:1;min-width:0">
    <div style="font-size:13px;font-weight:600;color:var(--tx)">${escapeHtml(chLeadName(x.lead))}</div>
    <div style="font-size:11px;color:var(--tx3);margin-top:2px">${escapeHtml(clientName(x.lead.client_id))} — ${x.last?'last requested '+fmtDate(new Date(x.last).toISOString()):'never requested'}</div>
  </div><button class="abtn" style="padding:4px 10px;font-size:12px" onclick="openReviewRequestModal(${x.lead.id},${x.lead.client_id})"><span class="mat sm">send</span>Request</button></div>`).join('');
}

// ---- Client review configuration editor (used from Reviews page + CDP tab) ----
function openReviewConfigEditor(clientId){
  const c = allClients.find(x=>x.id==clientId); if(!c) return;
  revLoadConfigs();
  const cfg = revGetConfig(clientId) || {};
  document.getElementById('revConfigModalTitle').textContent = 'Review Settings — ' + (c.company_name || 'Client');
  document.getElementById('revConfigModalBody').innerHTML = `
    <input type="hidden" id="revCfgClientId" value="${clientId}"/>
    <div class="form-group full"><label class="form-label">Review Landing URL</label><input class="form-input" id="revCfgReviewUrl" placeholder="https://reviews.upleaddigital.com/client-slug" value="${escapeHtml(cfg.review_url||'')}"/></div>
    <div class="form-group full"><label class="form-label">Google Review Destination URL</label><input class="form-input" id="revCfgGoogleUrl" placeholder="https://g.page/r/…/review" value="${escapeHtml(cfg.google_review_url||'')}"/></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--tx2);cursor:pointer;margin-top:2px">
      <input type="checkbox" id="revCfgEnabled" ${cfg.enabled!==false?'checked':''}/> Enabled — eligible to receive review requests
    </label>
    <div style="font-size:12px;color:var(--tx3);margin-top:6px;line-height:1.6">This URL belongs to the client/business, not to any individual lead. Every eligible customer of this client receives the same link. Saved locally as a frontend draft until the Client Review Configuration API is connected.</div>`;
  document.getElementById('revConfigModal').classList.add('open');
}
function closeReviewConfigModal(){ document.getElementById('revConfigModal').classList.remove('open'); }
function saveReviewConfig(){
  const id = document.getElementById('revCfgClientId').value;
  const cfg = {
    review_url: document.getElementById('revCfgReviewUrl').value.trim(),
    google_review_url: document.getElementById('revCfgGoogleUrl').value.trim(),
    enabled: document.getElementById('revCfgEnabled').checked
  };
  revSetConfig(id, cfg);
  closeReviewConfigModal();
  renderReviewClientConfigTable();
  if(currentClient && String(currentClient.id)===String(id)) renderCdpReviewsTab();
  toast('✓ Review settings saved (frontend draft)','ok');
}

// ---- Client Detail Panel: Reviews tab ----
function renderCdpReviewsTab(){
  if(!currentClient) return;
  revLoadConfigs();
  const cfg = revGetConfig(currentClient.id) || {};
  const urlEl=document.getElementById('cdpReviewUrl'), gUrlEl=document.getElementById('cdpGoogleReviewUrl'), enEl=document.getElementById('cdpReviewEnabled');
  if(urlEl) urlEl.value = cfg.review_url || '';
  if(gUrlEl) gUrlEl.value = cfg.google_review_url || '';
  if(enEl) enEl.checked = cfg.enabled !== false;
}
function cdpSaveReviewConfig(){
  if(!currentClient) return;
  const cfg = {
    review_url: document.getElementById('cdpReviewUrl').value.trim(),
    google_review_url: document.getElementById('cdpGoogleReviewUrl').value.trim(),
    enabled: document.getElementById('cdpReviewEnabled').checked
  };
  revSetConfig(currentClient.id, cfg);
  renderReviewClientConfigTable();
  toast('✓ Review settings saved (frontend draft)','ok');
}
function cdpCopyReviewLink(){
  if(!currentClient) return;
  const cfg = revGetConfig(currentClient.id);
  if(!cfg || !cfg.review_url){ toast('No review URL configured yet','err'); return; }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(cfg.review_url).then(()=>toast('✓ Review link copied','ok')).catch(()=>toast('Could not copy link','err'));
  }else{
    toast('Clipboard not available in this browser','err');
  }
}

// ---- Request Review composer (used from Lead panel + Client panel + Reviews page) ----
function openReviewRequestModal(leadId, clientIdOverride){
  revLoadConfigs();
  let lead = leadId ? allLeads.find(l=>l.id==leadId) : null;
  let client = null;

  if(clientIdOverride!=null){
    client = allClients.find(c=>c.id==clientIdOverride);
  }else if(lead){
    // Correct direction: a customer's business is found via lead.client_id.
    // client.lead_id (the single lead that originally converted into this
    // client record) is kept only as a legacy fallback for older rows that
    // predate lead.client_id.
    client = lead.client_id!=null ? allClients.find(c=>c.id==lead.client_id) : null;
    if(!client) client = allClients.find(c=>c.lead_id==lead.id);
  }else if(currentClient){
    client = currentClient;
  }

  if(!client){
    toast('This customer has no linked client yet — convert the lead to a client and configure review settings first.','err');
    return;
  }
  const cfg = revGetConfig(client.id);
  if(!cfg || !cfg.review_url || cfg.enabled===false){
    toast('No active review URL configured for '+(client.company_name||'this client')+'. Set it up under Reviews → Client Configuration.','err');
    return;
  }

  // A client is a BUSINESS, not a recipient — it can have many customers
  // (leads). If we weren't handed a specific customer, never guess one:
  // resolve the client's real customers via lead.client_id and either
  // auto-pick the only one, or ask which one.
  if(!lead){
    const clientLeads = allLeads.filter(l=>l.client_id===client.id);
    if(!clientLeads.length){
      toast('No customers are linked to '+(client.company_name||'this client')+' yet. Link a customer\'s client_id first, or open Request Review from that customer\'s lead record.','err');
      return;
    }
    if(clientLeads.length===1){
      lead = clientLeads[0];
    }else{
      openReviewLeadPicker(client, clientLeads);
      return;
    }
  }

  const firstName = lead.first_name || '';
  const lastName = lead.last_name || '';
  const phone = lead.phone || '';
  const vars = { first_name:firstName, last_name:lastName, business_name:client.company_name||'', review_url:cfg.review_url };
  const templates = revLoadTemplates();
  const message = revRenderTemplate(templates[0].content, vars);

  reviewComposerCtx = { leadId: lead.id, clientId: client.id, phone, vars };

  const sendBtn = document.getElementById('reviewRequestSendBtn');
  sendBtn.style.display = '';
  document.getElementById('reviewRequestModalBody').innerHTML = `
    <div class="lp-rows" style="border:1px solid var(--bd);border-radius:8px;overflow:hidden">
      <div class="lp-row"><div class="lp-ri"><span class="mat">person</span></div><div><div class="lp-rl">Customer (recipient)</div><div class="lp-rv">${escapeHtml((firstName+' '+lastName).trim()||'—')}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">call</span></div><div><div class="lp-rl">Phone</div><div class="lp-rv">${phone?escapeHtml(phone):'<span style="color:var(--re)">No phone on file</span>'}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">store</span></div><div><div class="lp-rl">Business being reviewed</div><div class="lp-rv">${escapeHtml(client.company_name||'—')}</div></div></div>
      <div class="lp-row"><div class="lp-ri"><span class="mat">link</span></div><div><div class="lp-rl">Review Link</div><div class="lp-rv" style="font-family:monospace;font-size:12.5px">${escapeHtml(cfg.review_url)}</div></div></div>
    </div>
    <div class="form-group full" style="margin-top:12px"><label class="form-label">Template</label>
      <select class="form-select" id="revComposerTemplate" onchange="revApplyTemplate(this.value)">
        ${templates.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group full"><label class="form-label">Message</label><textarea class="form-textarea" id="revComposerMessage" style="min-height:100px">${escapeHtml(message)}</textarea></div>
    <div style="font-size:12px;color:var(--tx3);margin-top:2px;line-height:1.6">Sending happens server-side via Twilio once the Review Request API is connected. This button calls that endpoint directly — nothing is simulated.</div>`;
  sendBtn.disabled = !phone;
  sendBtn.innerHTML = '<span class="mat sm">send</span>Send Review Request';
  document.getElementById('reviewRequestModal').classList.add('open');
}

// A client (business) can have many customers. When we only know the
// client, ask which of its real customers (lead.client_id === client.id)
// should receive the request, instead of silently guessing one.
function openReviewLeadPicker(client, leads){
  const sendBtn = document.getElementById('reviewRequestSendBtn');
  sendBtn.style.display = 'none';
  document.getElementById('reviewRequestModalBody').innerHTML = `
    <div style="font-size:13px;color:var(--tx2);margin-bottom:10px"><b>${escapeHtml(client.company_name||'This client')}</b> has more than one customer on file. Pick who should receive the review request:</div>
    <div class="lp-rows" style="border:1px solid var(--bd);border-radius:8px;overflow:hidden;max-height:280px;overflow-y:auto">
      ${leads.map(l=>`<div class="lp-row" style="cursor:pointer" onclick="openReviewRequestModal(${l.id},${client.id})">
        <div class="lp-ri"><span class="mat">person</span></div>
        <div style="flex:1"><div class="lp-rl">${escapeHtml(chLeadName(l))}</div><div class="lp-rv">${l.phone?escapeHtml(l.phone):'<span style="color:var(--re)">No phone on file</span>'}</div></div>
        <div class="lp-ri"><span class="mat">chevron_right</span></div>
      </div>`).join('')}
    </div>`;
  document.getElementById('reviewRequestModal').classList.add('open');
}

function revApplyTemplate(templateId){
  if(!reviewComposerCtx)return;
  const t=revLoadTemplates().find(x=>x.id===templateId);
  const box=document.getElementById('revComposerMessage');
  if(t&&box)box.value=revRenderTemplate(t.content,reviewComposerCtx.vars);
}
function closeReviewRequestModal(){
  document.getElementById('reviewRequestModal').classList.remove('open');
  reviewComposerCtx = null;
}

async function sendReviewRequestFromModal(){
  if(!reviewComposerCtx) return;
  if(!reviewComposerCtx.leadId){ toast('No customer selected for this request','err'); return; }
  const btn = document.getElementById('reviewRequestSendBtn');
  const message = document.getElementById('revComposerMessage').value;
  btn.disabled = true; btn.innerHTML = '<span class="mat sm spin">sync</span>Sending…';
  try{
    const res = await fetch(API.sendReviewRequest, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        action:'send_review_request',
        lead_id: reviewComposerCtx.leadId,
        client_id: reviewComposerCtx.clientId,
        channel:'sms',
        message
      })
    });
    if(!res.ok) throw new Error('http_'+res.status);
    await res.json().catch(()=>({}));
    toast('✓ Review request sent','ok');
    closeReviewRequestModal();
    revLoadRequestsFeed();
  }catch(e){
    console.warn('Reviews: send-review-request endpoint not connected yet:', e);
    toast('Review Request API is not connected yet. The composer is ready — wire up the send-review-request webhook to go live.', 'err');
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<span class="mat sm">send</span>Send Review Request';
  }
}

// ---- Recent Review Requests feed (real Activity Timeline data only) ----
let revActivitiesHaveClientId=false;
let revActivitiesHaveLeadId=false;
async function revLoadRequestsFeed(){
  const el = document.getElementById('revRequestsFeed'); if(!el) return;
  const badge = document.getElementById('revFeedStatusBadge');
  el.innerHTML = `<div class="empty-state"><span class="spin mat sm">sync</span><p>Loading review requests…</p></div>`;
  try{
    const res = await fetch(API.leadManagement, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'get_activities'})});
    if(!res.ok) throw new Error('not configured');
    const data = await res.json();
    const items = (Array.isArray(data)?data:(data.activities||[])).filter(a=>a.activity_type==='review_request');
    revActivitiesCache = items;
    revActivitiesHaveClientId = items.some(a=>a.client_id!=null);
    revActivitiesHaveLeadId = items.some(a=>a.lead_id!=null);
    if(badge){ badge.textContent='Connected'; badge.className='badge gr'; }
    renderReviewOverviewKpis(items);
    if(!items.length){ el.innerHTML = `<div class="empty-state"><span class="mat">reviews</span><p>No review requests sent yet.</p></div>`; return; }
    items.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    el.innerHTML = items.slice(0,50).map(a=>{
      const status = (a.activity_data && a.activity_data.status) || 'pending';
      const statusCls = {sent:'bl',delivered:'gr',failed:'re',pending:'am'}[status] || 'gy';
      const lead = a.lead_id!=null ? allLeads.find(l=>l.id==a.lead_id) : null;
      const client = a.client_id!=null ? allClients.find(c=>c.id==a.client_id) : null;
      const who = lead ? chLeadName(lead) : (a.lead_id!=null ? 'Lead #'+a.lead_id : 'Unknown customer');
      const forWhom = client ? (client.company_name||'—') : (a.client_id!=null ? 'Client #'+a.client_id : 'Unknown business');
      return `<div class="arow"><div class="activity-icon pu"><span class="mat sm">reviews</span></div><div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;color:var(--tx)">Review request to <b>${escapeHtml(who)}</b> for ${escapeHtml(forWhom)} <span class="badge ${statusCls}" style="margin-left:6px">${escapeHtml(status)}</span></div>
        <div style="font-size:11px;color:var(--tx3);margin-top:2px">${fmtDate(a.created_at)}</div>
      </div></div>`;
    }).join('');
  }catch(e){
    if(badge){ badge.textContent='Not connected'; badge.className='badge gy'; }
    revActivitiesCache = null;
    renderReviewOverviewKpis(null);
    el.innerHTML = `<div class="empty-state"><span class="mat">reviews</span><p>No backend data yet. Connect the Activity Timeline API to see real review-request history here.</p></div>`;
  }
}



/* ------------------------------------------------------------
   Deferred static UI wiring for the Communication Hub.
   These elements live inside pages/communication.html, which is
   fetched and injected by loader.js AFTER app.js has already run
   top-to-bottom. Calling these at parse time (as the single-file
   version could, since the markup was already in the DOM) threw
   on the first missing element and aborted the rest of app.js,
   which meant window.__initApp never got defined and the app hung
   on "Authenticating…" forever. Wiring is deferred here and run
   from window.__initApp, once the page fragments actually exist.
   ------------------------------------------------------------ */
function chOn(id,ev,fn){const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);}

function chWireStaticListeners(){
  chOn('chMuteBtn','click',e=>{
    const btn=e.currentTarget,on=!btn.classList.contains('active');
    btn.classList.toggle('active',on);
    btn.querySelector('.mat').textContent=on?'mic':'mic_off';
    VoiceService.toggleMute(on);
  });
  chOn('chHoldBtn','click',()=>{
    // Disabled — see the code comment on this button and on
    // TwilioVoiceAdapter.hold() above. Not wired to VoiceService.toggleHold()
    // on purpose so we never show a fake "on hold" state.
    toast('Hold isn\'t available yet — coming soon');
  });
  chOn('chKeypadBtn','click',()=>{
    document.getElementById('quickDialPanel').classList.toggle('open');
  });
  chOn('chEndCallBtn','click',()=>{
    VoiceService.hangUp();
  });

  chOn('chDeclineCallBtn','click',chDismissIncomingCall);
  chOn('chAnswerCallBtn','click',chDismissIncomingCall);

  document.querySelectorAll('#chProfileTabs .cd-tab').forEach(t=>{
    t.addEventListener('click',()=>{
      document.querySelectorAll('#chProfileTabs .cd-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const isFields=t.dataset.cdtab==='fields';
      document.getElementById('chProfileFieldsTab').style.display=isFields?'block':'none';
      document.getElementById('chProfileActionsTab').style.display=isFields?'none':'block';
    });
  });
  document.querySelectorAll('#chSmartViews .ch-sv').forEach(sv=>{
    sv.addEventListener('click',()=>{
      document.querySelectorAll('#chSmartViews .ch-sv').forEach(s=>s.classList.remove('active'));
      sv.classList.add('active');
      chRenderContactList(chFilteredLeads(sv.dataset.view));
    });
  });
  document.querySelectorAll('#chCommTabs .ch-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('#chCommTabs .ch-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      chActiveTab=tab.dataset.tab;
      chRenderTimeline(chFilterByTab(chActivities,chActiveTab));
    });
  });
  document.querySelectorAll('#chComposerChannels .topt').forEach(opt=>{
    opt.addEventListener('click',()=>{
      document.querySelectorAll('#chComposerChannels .topt').forEach(o=>o.classList.remove('active'));
      opt.classList.add('active');
      chActiveChannel=opt.dataset.ch;
      const meta=document.getElementById('chComposerMeta');
      const body=document.getElementById('chComposerBody');
      if(chActiveChannel==='email'){meta.style.display='flex';body.placeholder='Type your reply…';}
      else if(chActiveChannel==='sms'){meta.style.display='flex';body.placeholder='Type your text message…';}
      else{meta.style.display='none';body.placeholder='Internal note — not visible to the lead…';}
      chUpdateComposerTo();
      chLoadDraft();
    });
  });
  chOn('chComposerSendBtn','click',chSendMessage);
  chOn('chComposerDraftBtn','click',chSaveDraft);
  chOn('chQaEmail','click',()=>document.querySelector('#chComposerChannels .topt[data-ch="email"]').click());
  chOn('chQaSms','click',()=>document.querySelector('#chComposerChannels .topt[data-ch="sms"]').click());
  chOn('chPqSms','click',()=>document.querySelector('#chComposerChannels .topt[data-ch="sms"]').click());
  chOn('chQaCall','click',()=>{const l=allLeads.find(x=>x.id===chActiveLeadId);if(!l||!l.phone){toast('No phone number on file for this lead','err');return;}chStartCall(l,l.phone);});
  chOn('chPqCall','click',()=>{const l=allLeads.find(x=>x.id===chActiveLeadId);if(!l||!l.phone){toast('No phone number on file for this lead','err');return;}chStartCall(l,l.phone);});
  chOn('chQaMeeting','click',()=>{
    openScheduleMeetingModal();
    const sel=document.getElementById('mhSchLead');
    if(sel&&chActiveLeadId)sel.value=chActiveLeadId;
  });
  chOn('chQaOpenLead','click',()=>{if(chActiveLeadId)openLead(chActiveLeadId);});
  chOn('chQaStar','click',()=>{if(chActiveLeadId)chToggleStar(chActiveLeadId);});
  chOn('chSortToggle','click',()=>{
    chSortMode=chSortMode==='default'?'name':chSortMode==='name'?'recent':'default';
    const btn=document.getElementById('chSortToggle');
    btn.title=chSortMode==='name'?'Sorted by name — click for recent contact':chSortMode==='recent'?'Sorted by recent contact — click for default order':'Sort by name';
    chRenderContactList(chFilteredLeads(chCurrentView()));
  });
  chOn('chPqLead','click',()=>{if(chActiveLeadId)openLead(chActiveLeadId);});
  chOn('chRailFilterInput','input',e=>{
    const q=e.target.value.toLowerCase();
    const base=chFilteredLeads(chCurrentView());
    chRenderContactList(base.filter(l=>chLeadName(l).toLowerCase().includes(q)||(l.company_name||'').toLowerCase().includes(q)));
  });

  document.querySelectorAll('#chSubNav .ch-subnav-item').forEach(item=>{
    item.addEventListener('click',()=>chSwitchSubPage(item.dataset.sub));
  });

  /* Manual Actions tabs */
  document.querySelectorAll('#chManualTabs .ch-tasks-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('#chManualTabs .ch-tasks-tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      chManualView=tab.dataset.manualview;
      chRenderManualActions();
    });
  });
  chOn('chManualStartBtn','click',()=>{
    const rows=chManualRows(chManualView);
    if(!rows.length){toast('Nothing to start in this view','err');return;}
    chOpenInConversations(rows[0].id);
  });

  /* Snippets search */
  chOn('chSnippetsSearch','input',chRenderSnippets);
  chOn('chSnippetsSelectAll','change',e=>{
    document.querySelectorAll('#chSnippetsTableBody .ch-row-check').forEach(cb=>cb.checked=e.target.checked);
    chSnippetsUpdateBulkBar();
  });
  chOn('chSnippetsBulkDeleteBtn','click',chSnippetsBulkDelete);

  /* Manual Actions bulk-select */
  chOn('chManualSelectAll','change',e=>{
    document.querySelectorAll('#chManualTableBody .ch-row-check').forEach(cb=>cb.checked=e.target.checked);
    chManualUpdateBulkBar();
  });
  chOn('chManualBulkMarkBtn','click',chManualBulkMarkContacted);

  /* Composer quick-insert snippet popover */
  chOn('chComposerSnippetBtn','click',e=>{e.stopPropagation();chToggleSnippetQuickList();});
  document.addEventListener('click',e=>{
    const pop=document.getElementById('chSnippetQuickList');
    if(pop&&pop.classList.contains('open')&&!pop.contains(e.target)&&e.target.id!=='chComposerSnippetBtn')chToggleSnippetQuickList(false);
  });

  /* Keyboard navigation through the Conversations inbox: ↑/↓ moves the
     selection, Enter jumps focus into the reply box. Ignored while
     typing in any input/textarea, or outside the Conversations tab. */
  document.addEventListener('keydown',e=>{
    if(chSubPage!=='conversations')return;
    const tag=(document.activeElement&&document.activeElement.tagName)||'';
    if(tag==='INPUT'||tag==='TEXTAREA')return;
    if(!chLastRenderedList.length)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      let idx=chLastRenderedList.findIndex(l=>l.id===chActiveLeadId);
      if(idx===-1)idx=0;else idx=e.key==='ArrowDown'?Math.min(chLastRenderedList.length-1,idx+1):Math.max(0,idx-1);
      chSelectLead(chLastRenderedList[idx].id);
      document.querySelector(`#chContactList .ch-contact[data-id="${chLastRenderedList[idx].id}"]`)?.scrollIntoView({block:'nearest'});
    }else if(e.key==='Enter'&&chActiveLeadId){
      const composer=document.getElementById('chComposerBody');
      if(composer&&!composer.disabled)composer.focus();
    }
  });

  /* Trigger Links search + Link/Analyze tabs */
  chOn('chTriggerSearch','input',chRenderTriggerLinks);
  document.querySelectorAll('#chTriggerTabs .topt').forEach(t=>{
    t.addEventListener('click',()=>{
      document.querySelectorAll('#chTriggerTabs .topt').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const isLink=t.dataset.triggertab==='link';
      const linkView=document.getElementById('chTriggerLinkView'),analyzeView=document.getElementById('chTriggerAnalyzeView');
      if(linkView)linkView.style.display=isLink?'block':'none';
      if(analyzeView)analyzeView.style.display=isLink?'none':'block';
    });
  });
}

window.__initApp = function(){
  chWireStaticListeners();
  autoLoadStore();
  revLoadConfigs();
  bootAuth();
};
