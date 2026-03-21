/* ═══════════════════════════════════════════════════════════════════════════
   DisasterLink — script.js
   Handles API requests, map rendering, and admin authentication/actions
   ═══════════════════════════════════════════════════════════════════════════ */

const API_BASE = 'http://127.0.0.1:8000';
const WS_URL = 'ws://127.0.0.1:8000/ws';

// Register Service Worker for Offline PWA Capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .catch(err => console.warn('PWA SW registration failed:', err));
  });
}

let wsConnection = null;

/* ── Toast Notification ─────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { 
    el.style.animation = 'slideIn 0.3s ease reverse'; 
    setTimeout(() => el.remove(), 250); 
  }, 6000);
}

/* ── UI Helpers ───────────────────────────────────────────────────────────── */
function typeBadge(type) {
  const t = (type || 'other').toLowerCase().replace(/\s+/g, '');
  const m = { flood: 'flood', earthquake: 'earthquake', fire: 'fire', cyclone: 'cyclone', landslide: 'landslide' };
  return `<span class="badge badge-${m[t] || 'other'}">${type || 'Unknown'}</span>`;
}

function severityBadge(sev) {
  const s = (sev || 'Medium').toLowerCase();
  return `<span class="badge badge-${s}">${sev || 'Medium'}</span>`;
}

function statusBadge(st) {
  const s = (st || 'Open').toLowerCase().replace(/\s+/g, '');
  return `<span class="badge badge-${s}">${st || 'Open'}</span>`;
}

function skillBadge(sk) {
  return `<span class="skill-badge">${sk || 'Unknown'}</span>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function getAuthHeader() {
  const adminToken = localStorage.getItem('dl_admin_token');
  const volToken = localStorage.getItem('dl_vol_token');
  const isAdminPortal = document.getElementById('kpiGrid') !== null;
  const isVolPortal = document.getElementById('volDashboard') !== null;
  
  const headers = {};
  if (isAdminPortal && adminToken) {
    headers['X-Admin-Token'] = adminToken;
    headers['Authorization'] = `Bearer ${adminToken}`;
  } else if (isVolPortal && volToken) {
    headers['Authorization'] = `Bearer ${volToken}`;
  } else {
    if (adminToken) {
      headers['X-Admin-Token'] = adminToken;
      headers['Authorization'] = `Bearer ${adminToken}`;
    } else if (volToken) {
      headers['Authorization'] = `Bearer ${volToken}`;
    }
  }
  return headers;
}

/* ══════════════════════════════════════════════════════════════════════════
   HOME PAGE (index.html)
   ══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   REPORT DISASTER FORM (report.html)
   ══════════════════════════════════════════════════════════════════════════ */
function initReportForm() {
  const form = document.getElementById('reportForm');
  if (!form) return;

  const geoBtn = document.getElementById('btnLocateMe');
  const latField = document.getElementById('repLat');
  const lngField = document.getElementById('repLng');
  const statText = document.getElementById('locStatus');

  // Initialize interactive map for location picking
  let reportMap, reportMarker;
  const mapEl = document.getElementById('map');
  if (mapEl) {
    reportMap = L.map('map').setView([20.5937, 78.9629], 4);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(reportMap);

    reportMap.on('click', function (e) {
      if (!reportMarker) {
        reportMarker = L.marker(e.latlng).addTo(reportMap);
      } else {
        reportMarker.setLatLng(e.latlng);
      }
      latField.value = e.latlng.lat.toFixed(6);
      lngField.value = e.latlng.lng.toFixed(6);
      if (statText) statText.textContent = "📍 Location selected via map";
    });
  }

  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return showToast('Geolocation not supported.', 'error');
      geoBtn.disabled = true; geoBtn.innerHTML = '<div class="spinner"></div> Locating…';
      if (statText) statText.textContent = "Determining precise location...";

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          latField.value = pos.coords.latitude.toFixed(6);
          lngField.value = pos.coords.longitude.toFixed(6);
          geoBtn.disabled = false; geoBtn.innerHTML = '<span style="font-size:1.1em;">🎯</span> Use My Location';
          if (statText) statText.innerHTML = "<span style='color:var(--success)'>✅ Location acquired automatically</span>";
          showToast('Location captured successfully!');

          if (reportMap) {
            reportMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
            if (!reportMarker) reportMarker = L.marker([pos.coords.latitude, pos.coords.longitude]).addTo(reportMap);
            else reportMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
          }
        },
        () => {
          geoBtn.disabled = false; geoBtn.innerHTML = '<span style="font-size:1.1em;">🎯</span> Use My Location';
          if (statText) statText.innerHTML = "<span style='color:var(--danger)'>❌ Failed to acquire location</span>";
          showToast('Could not retrieve location.', 'error');
        }
      );
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!latField.value || !lngField.value) {
      showToast('❌ Please provide a location first.', 'error');
      return;
    }

    const btn = document.getElementById('submitReportBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';

    const preDef = document.getElementById('repPredefDesc') ? document.getElementById('repPredefDesc').value : '';
    const customDesc = document.getElementById('repDesc').value.trim();
    let finalDesc = preDef;
    if (customDesc) {
      finalDesc = finalDesc ? `${finalDesc} - ${customDesc}` : customDesc;
    }

    const payload = {
      disaster_type: document.getElementById('repType').value,
      severity: document.getElementById('repSeverity').value,
      description: finalDesc || null,
      latitude: parseFloat(latField.value),
      longitude: parseFloat(lngField.value),
      image_url: null,
      reporter_name: null,
      reporter_phone: null,
    };

    try {
      const res = await fetch(`${API_BASE}/reports/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Submission failed');
      showToast('✅ Report submitted successfully!');
      form.reset();
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
      btn.disabled = false; btn.textContent = '🚨 DISPATCH EMERGENCY REPORT';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   VOLUNTEER FORM (volunteer.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadPublicVolunteers() {
  const wrap = document.getElementById('volunteersTableWrapper');
  if (!wrap) return;
  try {
    const res = await fetch(`${API_BASE}/volunteers/`);
    if (!res.ok) throw new Error();
    const vols = await res.json();

    if (vols.length === 0) {
      wrap.innerHTML = `<p style="padding:1rem;color:var(--text-secondary)">No volunteers registered yet.</p>`;
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Name</th><th>Skill</th><th>Status</th><th>Joined</th></tr></thead>
          <tbody>
            ${vols.map(v => `
              <tr>
                <td style="font-weight:600">${v.name}</td>
                <td>${skillBadge(v.skill)}</td>
                <td>${v.assigned_report_id ? `<span class="badge badge-inprogress">Assigned to #${v.assigned_report_id}</span>` : `<span class="badge badge-open">Unassigned - Available</span>`}</td>
                <td style="color:var(--text-secondary);font-size:0.85rem">${formatDate(v.registered_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    wrap.innerHTML = `<p style="color:var(--danger)">Failed to load network.</p>`;
  }
}

function initVolunteerForm() {
  const form = document.getElementById('volunteerForm');
  if (!form) return;
  loadPublicVolunteers();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('volSubmitBtn');
    btn.disabled = true; btn.textContent = 'Registering…';

    const payload = {
      name: document.getElementById('volName').value.trim(),
      phone: document.getElementById('volPhone').value.trim(),
      skill: document.getElementById('volSkill').value,
    };

    try {
      const res = await fetch(`${API_BASE}/volunteers/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Registration failed');
      showToast('✅ Welcome to the DisasterLink Volunteer Network!');
      form.reset();
      loadPublicVolunteers();
    } catch (err) {
      showToast(`❌ ${err.message}`, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Join Network';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   TABS & COMMON DASHBOARD UI
   ══════════════════════════════════════════════════════════════════════════ */
function setupTabs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const btns = container.querySelectorAll('.tab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all
      btns.forEach(b => b.classList.remove('active'));
      const contents = container.parentElement.querySelectorAll('.tab-content');
      contents.forEach(c => c.classList.remove('active'));
      // Activate target
      btn.classList.add('active');
      document.getElementById(btn.dataset.target).classList.add('active');

      // Invalidate map size if map tab is clicked
      if (window.appMap) { setTimeout(() => { window.appMap.invalidateSize(); }, 50); }
    });
  });
}

// Global state for maps keeping it simple
let mapMarkers = [];
let dangerZones = [];

// Danger zone radius in meters based on disaster type
const DANGER_RADIUS_MAP = {
  fire: 2000, earthquake: 10000, flood: 5000,
  cyclone: 15000, landslide: 1000, other: 1000
};

function getDangerRadius(disasterType) {
  const t = (disasterType || '').toLowerCase();
  return DANGER_RADIUS_MAP[t] || DANGER_RADIUS_MAP['other'];
}

function initLeafletMap(mapId, reports) {
  const mapEl = document.getElementById(mapId);
  if (!mapEl) return;

  if (!window.appMap) {
    window.appMap = L.map(mapId).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(window.appMap);
  }

  // Clear existing markers and danger zones
  mapMarkers.forEach(m => window.appMap.removeLayer(m));
  mapMarkers = [];
  dangerZones.forEach(d => window.appMap.removeLayer(d));
  dangerZones = [];

  // Add new pins
  reports.forEach(r => {
    if (!r.latitude || !r.longitude) return;
    let color = '#3b82f6'; // default
    if (r.severity === 'Critical') color = '#dc2626';
    else if (r.severity === 'High') color = '#ea580c';
    else if (r.severity === 'Medium') color = '#ca8a04';
    else if (r.severity === 'Low') color = '#16a34a';

    const circle = L.circleMarker([r.latitude, r.longitude], {
      color: color, fillColor: color, fillOpacity: 0.7, radius: 8, weight: 2
    }).addTo(window.appMap);

    circle.bindPopup(`
      <strong style="font-size:1.1rem">${r.disaster_type}</strong><br/>
      ${severityBadge(r.severity)} ${statusBadge(r.status)}<br/>
      <p style="margin:5px 0">${r.description || 'No description provided'}</p>
      Report ID: <span style="font-family:var(--font-heading);font-weight:600">#${r.id}</span> <br/>
      Time: <span style="color:var(--text-muted);font-size:0.85rem">${formatDate(r.timestamp)}</span>
    `);
    mapMarkers.push(circle);

    // Danger Zone: draw impact radius for Critical/High severity
    if (r.severity === 'Critical' || r.severity === 'High') {
      const radius = getDangerRadius(r.disaster_type);
      const zone = L.circle([r.latitude, r.longitude], {
        radius: radius, color: color, fillColor: color,
        fillOpacity: 0.08, weight: 1, dashArray: '6,4',
        className: 'danger-zone-circle'
      }).addTo(window.appMap);
      zone.bindTooltip(`⚠ ${r.disaster_type} Danger Zone (~${(radius/1000).toFixed(0)}km)`, { permanent: false, direction: 'center' });
      dangerZones.push(zone);
    }
  });

  // Auto fit map bounds if we have points
  if (mapMarkers.length > 0) {
    const group = new L.featureGroup(mapMarkers);
    window.appMap.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 12 });
  }
}

function addSingleReportToMap(r) {
  if (!window.appMap || !r.latitude || !r.longitude) return;

  let color = '#3b82f6';
  if (r.severity === 'Critical') color = '#dc2626';
  else if (r.severity === 'High') color = '#ea580c';
  else if (r.severity === 'Medium') color = '#ca8a04';
  else if (r.severity === 'Low') color = '#16a34a';

  const circle = L.circleMarker([r.latitude, r.longitude], {
    color: color, fillColor: color, fillOpacity: 0.7, radius: 8, weight: 2
  }).addTo(window.appMap);

  circle.bindPopup(`
    <strong style="font-size:1.1rem">${r.disaster_type}</strong><br/>
    ${severityBadge(r.severity)} ${statusBadge(r.status)}<br/>
    <p style="margin:5px 0">${r.description || 'No description provided'}</p>
    Report ID: #${r.id} <br/>
    Time: <span style="color:#666">${formatDate(r.timestamp)}</span>
  `);
  mapMarkers.push(circle);

  // Danger Zone for Critical/High
  if (r.severity === 'Critical' || r.severity === 'High') {
    const radius = getDangerRadius(r.disaster_type);
    const zone = L.circle([r.latitude, r.longitude], {
      radius: radius, color: color, fillColor: color,
      fillOpacity: 0.08, weight: 1, dashArray: '6,4',
      className: 'danger-zone-circle'
    }).addTo(window.appMap);
    zone.bindTooltip(`⚠ ${r.disaster_type} Danger Zone (~${(radius/1000).toFixed(0)}km)`, { permanent: false, direction: 'center' });
    dangerZones.push(zone);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC DASHBOARD (dashboard.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadPublicDashboard() {
  if (!document.getElementById('publicKpiGrid')) return;

  try {
    // 1. Load Stats
    const statsRes = await fetch(`${API_BASE}/stats`);
    if (statsRes.ok) {
      const st = await statsRes.json();
      document.getElementById('pubTotalReports').textContent = st.total_reports;
      document.getElementById('pubCritical').textContent = st.critical_reports;
      document.getElementById('pubActiveCamps').textContent = st.active_camps;
      document.getElementById('pubAlerts').textContent = st.total_alerts;
    }

    // 2. Load Reports + Map (only active/in-progress — hide resolved ones)
    const repRes = await fetch(`${API_BASE}/reports/`);
    let allReports = [];
    if (repRes.ok) allReports = await repRes.json();
    const reports = allReports.filter(r => r.status !== 'Resolved');

    // Also fetch camps for "Nearest Camp" calculation
    let camps = [];
    try {
      const cmpRes = await fetch(`${API_BASE}/camps/`);
      if (cmpRes.ok) camps = await cmpRes.json();
    } catch (e) { }

    if (reports.length >= 0) {
      document.getElementById('reportCount').textContent = `${reports.length} active incident${reports.length !== 1 ? 's' : ''}`;
      initLeafletMap('publicIncidentMap', reports);

      const tbody = document.getElementById('tableWrapper');
      if (reports.length === 0) {
        tbody.innerHTML = `<p style="padding:1rem;color:var(--text-secondary)">✅ No active incidents. All resolved.</p>`;
      } else {
        // Simple distance function
        const getDist = (lat1, lon1, lat2, lon2) => Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lon1 - lon2, 2));

        tbody.innerHTML = `
          <div class="table-wrapper">
            <table>
              <thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Status</th><th>Nearest Camp</th><th>Reported</th></tr></thead>
              <tbody>
                ${reports.map(r => {
          let nearestStr = '—';
          if (camps.length > 0) {
            // Try to guess lat/lon for camp from its string location (demo-grade hack) or just show the first if parsing fails
            // Since camps lack precise coords in the DB schema, we'll just show the first available camp if the name matches a city, or a generic text.
            // For a real app, camps need lat/lon. Here we just pick a random/demo camp for illustration.
            const camp = camps[r.id % camps.length] || camps[0];
            nearestStr = `<span style="font-size:0.85rem;color:var(--primary);font-weight:600;">${camp.camp_name || 'Generic Camp'}</span>`;
          }

          return `
                  <tr>
                    <td>#${r.id}</td>
                    <td>${typeBadge(r.disaster_type)}</td>
                    <td>${severityBadge(r.severity)}</td>
                    <td>${statusBadge(r.status)}</td>
                    <td>${nearestStr}</td>
                    <td style="color:var(--text-secondary);font-size:0.8rem">${formatDate(r.timestamp)}</td>
                  </tr>`
        }).join('')}
              </tbody>
            </table>
          </div>`;
      }
    }

    // 3. Load Alerts
    const alertRes = await fetch(`${API_BASE}/alerts/`);
    if (alertRes.ok) {
      const alerts = await alertRes.json();
      document.getElementById('publicAlertsWrapper').innerHTML = alerts.length === 0
        ? `<p style="color:var(--text-secondary)">No active alerts.</p>`
        : `<div class="table-wrapper"><table>
             <thead><tr><th>Severity</th><th>Location</th><th>Message</th><th>Issued At</th></tr></thead>
             <tbody>${alerts.map(a => `<tr><td>${severityBadge(a.severity)}</td><td style="font-weight:600">${a.location}</td><td>${a.message}</td><td style="color:var(--text-secondary);font-size:0.8rem">${formatDate(a.timestamp)}</td></tr>`).join('')}</tbody>
           </table></div>`;
    }

    // 4. Load Camps
    const campRes = await fetch(`${API_BASE}/camps/`);
    if (campRes.ok) {
      const camps = await campRes.json();
      document.getElementById('publicCampsWrapper').innerHTML = camps.length === 0
        ? `<p style="color:var(--text-secondary)">No relief camps registered.</p>`
        : `<div class="table-wrapper"><table>
             <thead><tr><th>Camp Name</th><th>Location</th><th>Occupancy</th></tr></thead>
             <tbody>${camps.map(c => {
          const pct = Math.round((c.occupancy / c.capacity) * 100);
          const cClass = pct >= 95 ? 'var(--danger)' : (pct > 75 ? 'var(--warning)' : 'var(--primary)');
          return `<tr>
                 <td style="font-weight:600">${c.camp_name}</td>
                 <td>${c.location}</td>
                 <td>
                   <div style="display:flex;align-items:center;gap:10px;">
                     <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
                       <div style="height:100%;width:${pct}%;background:${cClass}"></div>
                     </div>
                     <span style="font-size:0.8rem;color:${cClass};font-weight:600">${c.occupancy} / ${c.capacity}</span>
                   </div>
                 </td>
               </tr>`;
        }).join('')}</tbody>
           </table></div>`;
    }

  } catch (e) {
    console.error(e);
    showToast('Failed to sync live data.', 'error');
  }
}

/* ── WebSockets Integration ────────────────────────────────────────────────── */
function setupWebSocket() {
  if (wsConnection) {
    wsConnection.close();
  }

  wsConnection = new WebSocket(WS_URL);

  wsConnection.onopen = () => {
    console.log('Connected to DisasterLink Live Stream');
  };

  wsConnection.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleLiveEvent(msg);
    } catch (e) {
      console.error("WS Parse error", e);
    }
  };

  wsConnection.onclose = () => {
    console.log('Live Stream disconnected. Reconnecting in 5s...');
    setTimeout(setupWebSocket, 2000);
  };
}

function handleLiveEvent(msg) {
  const tType = msg.type;
  const data = msg.data;

  if (tType === 'NEW_REPORT') {
    showToast(`🚨 NEW ${data.severity.toUpperCase()} ALERT: ${data.disaster_type} reported!`);

    // Update Map implicitly
    addSingleReportToMap(data);

    // Add to Admin Live Activity Feed
    addLiveActivity('🚨', `New ${data.severity.toUpperCase()} Report`, `${data.disaster_type} near ${data.latitude.toFixed(3)}, ${data.longitude.toFixed(3)}`);

    if (document.getElementById('adminReportsTableWrapper')) {
      loadAdminDash(); // Refresh admin feed 
    }

    // Update Table implicitly
    const tbody = document.querySelector('#tableWrapper tbody');
    if (tbody) {
      const row = document.createElement('tr');
      // Adding a brief flash animation via inline style for demonstration
      row.style.animation = 'flash 2s ease-out';
      row.innerHTML = `
        <td>#${data.id}</td>
        <td>${typeBadge(data.disaster_type)}</td>
        <td>${severityBadge(data.severity)}</td>
        <td>${statusBadge(data.status)}</td>
        <td>${data.description ? (data.description.length > 40 ? data.description.slice(0, 40) + '…' : data.description) : '—'}</td>
        <td style="color:var(--text-secondary);font-size:0.8rem">${formatDate(data.timestamp)}</td>
      `;
      tbody.prepend(row);

      // Update count
      const cntEl = document.getElementById('reportCount');
      if (cntEl) {
        let cnt = parseInt(cntEl.textContent) || 0;
        cnt++;
        cntEl.textContent = `${cnt} report${cnt !== 1 ? 's' : ''}`;
      }
    }

    // Update KPI
    const totalEl = document.getElementById('pubTotalReports');
    if (totalEl && totalEl.textContent !== '—') {
      totalEl.textContent = parseInt(totalEl.textContent) + 1;
    }
    if (data.severity === 'Critical') {
      const critEl = document.getElementById('pubCritical');
      if (critEl && critEl.textContent !== '—') {
        critEl.textContent = parseInt(critEl.textContent) + 1;
      }
    }

  } else if (tType === 'NEW_ALERT') {
    showToast(`📢 AUTHORITY ALERT: ${data.message}`);
    addLiveActivity('📢', 'Alert Broadcasted', data.message);
    // Inject into dashboard alerts table immediately (no reload)
    injectAlertRow({ severity: data.severity || 'Info', location: data.location || '—', message: data.message, timestamp: new Date().toISOString() });

  } else if (tType === 'DISPATCH') {
    const names = (data.dispatched_volunteers || []).map(v => v.name || v).join(', ');
    showToast(`🏃 ${data.dispatched_volunteers.length} volunteer(s) dispatched to Report #${data.report_id}!`, 'success');
    addLiveActivity('🏃', `Volunteers Dispatched`, `${names} deployed to Report #${data.report_id}`);
    
    injectAlertRow({ severity: 'Info', location: `Report #${data.report_id}`, message: `🏃 Volunteer(s) dispatched: ${names}`, timestamp: new Date().toISOString() });
    if (typeof window.loadMyAssignment === 'function') window.loadMyAssignment();

  } else if (tType === 'VOLUNTEER_UPDATE') {
    const statusEmoji = data.status === 'COMPLETED' ? '✅' : data.status === 'EN_ROUTE' ? '🚗' : data.status === 'REACHED' ? '📍' : '📡';
    showToast(`${statusEmoji} ${data.name}: ${data.status}`);
    addLiveActivity(statusEmoji, `Volunteer Status: ${data.status}`, `${data.name} updated to ${data.status}.`);

    if (data.status === 'COMPLETED') {
      injectAlertRow({ severity: 'Info', location: `Report #${data.assigned_report_id || '?'}`, message: `✅ Incident resolved by volunteer ${data.name}`, timestamp: new Date().toISOString() });
      if (document.getElementById('homeStatGrid')) loadHomeDashboard();
      if (document.getElementById('publicKpiGrid')) loadPublicDashboard();
    } else {
      injectAlertRow({ severity: 'Info', location: `Report #${data.assigned_report_id || '?'}`, message: `${statusEmoji} ${data.name}: ${data.status}`, timestamp: new Date().toISOString() });
    }
  }
}

function addLiveActivity(icon, title, desc) {
  const panel = document.getElementById('liveFeedPanel');
  if (!panel) return;
  // Remove waiting text if present
  if (panel.innerHTML.includes('Waiting for events')) panel.innerHTML = '';

  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
  const html = `
    <div style="background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.75rem;animation:slideIn 0.3s ease-out;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
        <span style="font-size:0.85rem;font-weight:700;letter-spacing:0.02em;">${icon} ${title}</span>
        <span style="font-size:0.75rem;font-family:var(--font-mono);color:var(--text-muted);">${timeStr}</span>
      </div>
      <div style="font-size:0.85rem;color:var(--text-secondary);">${desc}</div>
    </div>
  `;
  panel.insertAdjacentHTML('afterbegin', html);
  // Keep max 20
  if (panel.children.length > 20) panel.lastElementChild.remove();
}

/**
 * injectAlertRow — surgically prepend a row to the dashboard Alerts table.
 * Works on both the public dashboard (publicAlertsWrapper) and
 * passes gracefully if the wrapper doesn't exist (e.g. on home page).
 */
function injectAlertRow(alert) {
  const wrap = document.getElementById('publicAlertsWrapper');
  if (!wrap) return;

  const severity = (alert.severity || 'Info');
  const severityColor = severity === 'Critical' ? 'var(--danger)' : severity === 'High' ? 'var(--warning)' : 'var(--info)';
  const timeStr = formatDate(alert.timestamp || new Date().toISOString());

  // Ensure the table structure exists; create it if the wrapper is empty or has "No alerts" text
  let tbody = wrap.querySelector('tbody');
  if (!tbody) {
    wrap.innerHTML = `
      <div class="table-wrapper"><table>
        <thead><tr><th>Severity</th><th>Location</th><th>Update</th><th>Time</th></tr></thead>
        <tbody></tbody>
      </table></div>`;
    tbody = wrap.querySelector('tbody');
  }

  const row = document.createElement('tr');
  row.style.animation = 'slideIn 0.35s ease-out';
  row.innerHTML = `
    <td><span class="badge" style="background:${severityColor}22;color:${severityColor};border:1px solid ${severityColor}44">${severity}</span></td>
    <td style="font-weight:600">${alert.location || '—'}</td>
    <td>${alert.message}</td>
    <td style="color:var(--text-secondary);font-size:0.8rem">${timeStr}</td>
  `;
  tbody.prepend(row);
  // Keep max 30 rows
  if (tbody.children.length > 30) tbody.lastElementChild.remove();
}


/* ══════════════════════════════════════════════════════════════════════════
/* ══════════════════════════════════════════════════════════════════════════
   ADMIN SYSTEM (admin.html)
   ══════════════════════════════════════════════════════════════════════════ */
function initAdminAuth() {
  const token = localStorage.getItem('dl_admin_token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // Show navigation actions
  const navLinks = document.getElementById('adminNavLinks');
  const cmdActions = document.getElementById('adminCmdActions');
  if (navLinks) navLinks.style.display = 'flex';
  if (cmdActions) cmdActions.style.display = 'flex';

  loadAdminDash();

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('dl_admin_token');
      window.location.reload();
    });
  }
}

async function loadAdminDash() {
  const headers = getAuthHeader();

  // 1. Stats
  try {
    const stRes = await fetch(`${API_BASE}/stats`);
    const st = await stRes.json();
    document.getElementById('kpiReports').textContent = st.total_reports;
    document.getElementById('kpiCritical').textContent = st.critical_reports;
    document.getElementById('kpiCamps').textContent = st.active_camps;
    document.getElementById('kpiVols').textContent = st.total_volunteers;
  } catch (e) { }

  // 2. Reports
  try {
    const repRes = await fetch(`${API_BASE}/reports/`);
    const reports = await repRes.json();
    const activeReports = reports.filter(r => r.status !== 'Resolved');
    document.getElementById('reportCount').textContent = `${activeReports.length} active / ${reports.length} total`;
    initLeafletMap('incidentMap', activeReports); // Only plot active incidents on map

    // Populate Camp Location Dropdown with Active Disasters
    const campLocSel = document.getElementById('campLoc');
    if (campLocSel) {
      const currentVal = campLocSel.value;
      campLocSel.innerHTML = '<option value="">Select Active Disaster Zone…</option>' + 
        activeReports.map(r => {
          const locText = `${r.disaster_type} zone (${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)})`;
          return `<option value="${locText}" ${currentVal === locText ? 'selected' : ''}>Report #${r.id}: ${r.disaster_type} - Severity: ${r.severity}</option>`;
        }).join('');
    }

    const tblWrap = document.getElementById('adminReportsTableWrapper');
    if (reports.length === 0) tblWrap.innerHTML = `<p style="padding:1rem;">No reports.</p>`;
    else {
      tblWrap.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead><tr><th>ID</th><th>Severity</th><th>Type</th><th>Location (Lat,Lon)</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${reports.map(r => {
                const isResolved = r.status === 'Resolved';
                const rowStyle = isResolved ? 'opacity:0.45;' : '';
                return `
                <tr style="${rowStyle}">
                  <td>#${r.id}</td>
                  <td>${severityBadge(r.severity)}</td>
                  <td>${typeBadge(r.disaster_type)}</td>
                  <td><code style="font-size:0.8rem">${r.latitude}, ${r.longitude}</code></td>
                  <td>${r.description || '—'}</td>
                  <td>
                    <select class="table-select" onchange="updateReportStatus(${r.id}, this.value)">
                      <option value="Open" ${r.status === 'Open' ? 'selected' : ''}>Open</option>
                      <option value="In Progress" ${r.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                      <option value="Resolved" ${r.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                    </select>
                  </td>
                  <td><button class="table-action-btn" onclick="deleteEntity('reports', ${r.id})" title="Delete">🗑️</button></td>
                </tr>`}).join('')}
            </tbody>
          </table>
        </div>`;
    }

    // 2b. Clusters
    try {
      const cluRes = await fetch(`${API_BASE}/reports/clusters`, { headers: getAuthHeader() });
      const clusters = await cluRes.json();
      const cluWrap = document.getElementById('adminClustersTableWrapper');
      if (cluWrap) {
        if (clusters.length === 0) {
          cluWrap.innerHTML = `<p style="padding:1rem;">No clusters detected.</p>`;
        } else {
          cluWrap.innerHTML = `
            <div class="table-wrapper">
              <table>
                <thead><tr><th>#</th><th>Type</th><th>Severity</th><th>Status</th><th>Description</th><th>Action</th></tr></thead>
                <tbody>
                  ${clusters.map(c => `
                    <tr>
                      <td style="font-weight:600;color:var(--text-muted);">#${c.cluster_id}</td>
                      <td>${typeBadge(c.disaster_type)}</td>
                      <td>${severityBadge(c.severity)}</td>
                      <td><span style="font-size:0.8rem;font-weight:700;color:var(--text-secondary);">${c.status || 'Open'}</span></td>
                      <td style="max-width:280px;font-size:0.85rem;color:var(--text-secondary);">${c.description || '—'}</td>
                      <td>
                        <button class="btn btn-ghost btn-sm" onclick="dispatchCluster(${c.cluster_id}, this)">⚡ Dispatch</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`;
        }
      }
    } catch (e) { console.error("Error loading clusters", e); }

  } catch (e) { }

  // 3. Alerts
  try {
    const alRes = await fetch(`${API_BASE}/alerts/`);
    const alerts = await alRes.json();
    const aWrap = document.getElementById('adminAlertsTableWrapper');
    aWrap.innerHTML = alerts.length === 0 ? `<p>No alerts.</p>` : `
      <div class="table-wrapper">
        <table style="font-size:0.9rem">
          <thead><tr><th>Severity</th><th>Location</th><th>Message</th><th>Actions</th></tr></thead>
          <tbody>${alerts.map(a => `<tr><td>${severityBadge(a.severity)}</td><td>${a.location}</td><td>${a.message}</td>
          <td><button class="table-action-btn" onclick="deleteEntity('alerts', ${a.id})">🗑️</button></td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { }

  // 4. Camps
  try {
    const cmpRes = await fetch(`${API_BASE}/camps/`);
    const camps = await cmpRes.json();
    const cWrap = document.getElementById('adminCampsTableWrapper');
    cWrap.innerHTML = camps.length === 0 ? `<p>No camps.</p>` : `
      <div class="table-wrapper">
        <table style="font-size:0.9rem">
          <thead><tr><th>Name</th><th>Location</th><th>Max Capacity</th><th>Actions</th></tr></thead>
          <tbody>${camps.map(c => `<tr>
            <td style="font-weight:600">${c.camp_name}</td><td>${c.location}</td>
            <td style="font-weight:700;">${c.capacity}</td>
            <td><button class="table-action-btn" onclick="deleteEntity('camps', ${c.id})">🗑️</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { }

  // 5. Volunteers
  try {
    const vRes = await fetch(`${API_BASE}/volunteers/`);
    const vols = await vRes.json();
    const vWrap = document.getElementById('adminVolsTableWrapper');
    vWrap.innerHTML = vols.length === 0 ? `<p>No volunteers.</p>` : `
      <div class="table-wrapper">
        <table style="font-size:0.9rem">
          <thead><tr><th>Name</th><th>Phone</th><th>Skill</th><th>Last Known GPS</th><th>Assignment</th><th>Status</th></tr></thead>
          <tbody>${vols.map(v => `<tr>
            <td>${v.name}</td><td>${v.phone || '—'}</td><td>${skillBadge(v.skill)}</td>
            <td>
              ${(v.latitude && v.longitude) 
                ? `<span title="${v.latitude.toFixed(4)}, ${v.longitude.toFixed(4)}" style="color:var(--success);display:inline-flex;align-items:center;gap:0.25rem;">📡 <span style="font-family:var(--font-mono);font-size:0.8rem">${v.latitude.toFixed(2)},${v.longitude.toFixed(2)}</span></span>` 
                : '<span style="color:var(--text-muted);font-size:0.8rem;">📍 No GPS Data</span>'}
            </td>
            <td>${(v.assigned_report_id && v.volunteer_status !== 'COMPLETED' && v.volunteer_status !== 'Available') ? `<span style="font-weight:700;color:var(--primary)">Report #${v.assigned_report_id}</span>` : '<span style="color:var(--text-muted);font-size:0.8rem">Unassigned</span>'}</td>
            <td>
              ${(() => {
                const stat = v.volunteer_status || 'Available';
                if (stat === 'COMPLETED' || stat === 'Available') {
                  return `<span style="font-size:0.8rem;font-weight:700;color:var(--text-muted)">FREE</span>`;
                }
                return `<span style="font-size:0.8rem;font-weight:700;color:var(--info)">ASSIGNED</span>`;
              })()}
            </td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;

    // Live Map Tracking for Active Volunteers
    if (window.appMap) {
      if (window.volMarkers) { window.volMarkers.forEach(m => window.appMap.removeLayer(m)); }
      window.volMarkers = [];
      vols.forEach(v => {
        if (v.latitude && v.longitude && v.assigned_report_id) {
          const circle = L.circleMarker([v.latitude, v.longitude], {
            color: '#10b981', fillColor: '#10b981', fillOpacity: 0.9, radius: 6, weight: 2
          }).addTo(window.appMap);
          circle.bindPopup(`<strong>🧑‍⚕️ ${v.name}</strong><br/>Skill: ${v.skill}<br/>Status: <b>${v.volunteer_status || 'Assigned'}</b>`);
          window.volMarkers.push(circle);
        }
      });
    }
  } catch (e) { }

  // 6. Weather Intelligence
  loadWeatherIntel();

  // 7. Camp Resources / Supplies
  loadCampResources();
}

/* ── Admin Action Helpers ────────────────────────────────────────────────── */
async function updateReportStatus(id, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/reports/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error();
    showToast(`Updated Report #${id} to ${newStatus}`);
  } catch (e) { showToast(`Failed to update status`, 'error'); }
}

async function dispatchCluster(reportId, btnEl) {
  // Find and animate the cluster row for instant visual feedback
  const row = btnEl ? btnEl.closest('tr') : null;
  if (row) {
    row.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
  }
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid #fff;border-bottom-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;"></span> Dispatching…'; }

  try {
    const res = await fetch(`${API_BASE}/reports/${reportId}/dispatch`, {
      method: 'POST', headers: getAuthHeader()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    // Build a rich notification showing volunteer names
    const volNames = (data.volunteers || data.dispatched_volunteers || []).map(v => v.name || v).join(', ') || 'a volunteer';
    showToast(`✅ ${volNames} dispatched to Report #${reportId}!`, 'success');

    // Surgically remove the row from the clusters table (no full reload)
    if (row) {
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      setTimeout(() => row.remove(), 400);
    }

    // Refresh only the volunteers section to show new assignment
    setTimeout(() => {
      if (document.getElementById('adminVolsTableWrapper')) loadAdminDash();
    }, 500);
  } catch (e) {
    showToast(`❌ Dispatch failed: ${e.message}`, 'error');
    if (row) { row.style.opacity = '1'; row.style.pointerEvents = ''; }
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '⚡ Dispatch'; }
  }
}

async function deleteEntity(endpoint, id, btnEl) {
  if (!confirm(`Are you sure you want to delete this ${endpoint.slice(0, -1)}?`)) return;
  try {
    if (btnEl) btnEl.disabled = true;
    const res = await fetch(`${API_BASE}/${endpoint}/${id}`, {
      method: 'DELETE', headers: getAuthHeader()
    });
    if (!res.ok) throw new Error();
    showToast(`✅ Deleted ${endpoint.slice(0, -1)}`);
    if (btnEl) {
      const row = btnEl.closest('tr');
      if (row) {
        row.style.transition = 'opacity 0.3s ease';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 300);
      }
    }
    
    // Explicitly update corresponding dropdowns
    if (endpoint === 'camps') {
      setTimeout(() => loadCampResources(), 400);
    }
    
  } catch (e) { 
    showToast(`Failed to delete`, 'error'); 
    if (btnEl) btnEl.disabled = false;
  }
}

async function updateCampOcc(id) {
  const occ = parseInt(document.getElementById(`occ_${id}`).value) || 0;
  try {
    const res = await fetch(`${API_BASE}/camps/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ occupancy: occ })
    });
    if (!res.ok) throw new Error();
    showToast(`✅ Camp occupancy updated`);
    loadAdminDash();
  } catch (e) { showToast(`Failed to update`, 'error'); }
}

async function assignVol(id) {
  const rId = document.getElementById(`volass_${id}`).value;
  const payload = { assigned_report_id: rId ? parseInt(rId) : null };
  try {
    const res = await fetch(`${API_BASE}/volunteers/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error();
    showToast(`✅ Volunteer assignment updated`);
    loadAdminDash();
  } catch (e) { showToast(`Failed to update`, 'error'); }
}

/* ── Admin Forms ─────────────────────────────────────────────────────────── */
function initAdminForms() {
  const alertForm = document.getElementById('alertForm');
  if (alertForm) {
    alertForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`${API_BASE}/alerts/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            message: document.getElementById('alertMsg').value,
            location: document.getElementById('alertLoc').value,
            severity: document.getElementById('alertSev').value
          })
        });
        if (!res.ok) throw new Error();
        showToast('📢 Broadcasted Alert Successfully!');
        alertForm.reset();
        reloadAdminAlerts(); // Surgical decoupled reload
      } catch (er) { showToast('Failure to broadcast', 'error'); }
    });
  }

  const campForm = document.getElementById('campForm');
  if (campForm) {
    campForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`${API_BASE}/camps/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({
            camp_name: document.getElementById('campName').value,
            location: document.getElementById('campLoc').value,
            capacity: parseInt(document.getElementById('campCap').value)
          })
        });
        if (!res.ok) throw new Error();
        showToast('⛺ New Camp Registered!');
        campForm.reset();
        reloadAdminCamps(); // Surgical decoupled reload
      } catch (er) { showToast('Failure to create camp', 'error'); }
    });
  }
}

// Sub-loaders for decoupled DOM updates
async function reloadAdminAlerts() {
  try {
    const alRes = await fetch(`${API_BASE}/alerts/`);
    const alerts = await alRes.json();
    const aWrap = document.getElementById('adminAlertsTableWrapper');
    aWrap.innerHTML = alerts.length === 0 ? `<p>No alerts.</p>` : `
      <div class="table-wrapper">
        <table style="font-size:0.9rem">
          <thead><tr><th>Severity</th><th>Location</th><th>Message</th><th>Actions</th></tr></thead>
          <tbody>${alerts.map(a => `<tr><td>${severityBadge(a.severity)}</td><td>${a.location}</td><td>${a.message}</td>
          <td><button class="table-action-btn" onclick="deleteEntity('alerts', ${a.id}, this)">🗑️</button></td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { }
}

async function reloadAdminCamps() {
  try {
    const cmpRes = await fetch(`${API_BASE}/camps/`);
    const camps = await cmpRes.json();
    const cWrap = document.getElementById('adminCampsTableWrapper');
    cWrap.innerHTML = camps.length === 0 ? `<p>No camps.</p>` : `
      <div class="table-wrapper">
        <table style="font-size:0.9rem">
          <thead><tr><th>Name</th><th>Location</th><th>Max Capacity</th><th>Actions</th></tr></thead>
          <tbody>${camps.map(c => `<tr>
            <td style="font-weight:600">${c.camp_name}</td><td>${c.location}</td>
            <td style="font-weight:700;">${c.capacity}</td>
            <td><button class="table-action-btn" onclick="deleteEntity('camps', ${c.id}, this)">🗑️</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   HOME PAGE — Stats + Alert Ticker (index.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadHomeDashboard() {
  if (!document.getElementById('homeStatGrid')) return;

  try {
    const [statsRes, alertRes] = await Promise.all([
      fetch(`${API_BASE}/stats`),
      fetch(`${API_BASE}/alerts/`)
    ]);

    // KPI strip
    if (statsRes.ok) {
      const st = await statsRes.json();
      const el = (id) => document.getElementById(id);
      if (el('homeStatCritical')) el('homeStatCritical').textContent = st.critical_reports ?? '0';
      if (el('homeStatActive')) el('homeStatActive').textContent = st.total_reports ?? '0';
      if (el('homeStatCamps')) el('homeStatCamps').textContent = st.active_camps ?? '0';
      if (el('homeStatVols')) el('homeStatVols').textContent = st.total_volunteers ?? '0';
    }

    // Alert ticker
    if (alertRes.ok) {
      const alerts = await alertRes.json();
      const ticker = document.getElementById('alertTicker');
      const tickerT = document.getElementById('tickerText');
      if (alerts.length > 0 && ticker && tickerT) {
        ticker.classList.remove('hidden');
        const sev = (alerts[0].severity || 'Info').toLowerCase();
        ticker.style.background = 'rgba(10,10,10,0.92)';
        ticker.style.backdropFilter = 'blur(16px)';
        ticker.style.color = '#fff';
        ticker.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
        ticker.style.borderLeft = `4px solid ${sev === 'critical' ? 'var(--danger)' : sev === 'warning' ? 'var(--warning)' : 'var(--info)'}`;
        tickerT.textContent = `[${alerts[0].severity}] ${alerts[0].location}: ${alerts[0].message}`;
      }
    }

  } catch (e) { console.warn('Home load error', e); }
}

/* ══════════════════════════════════════════════════════════════════════════
   3-STEP REPORT WIZARD (report.html)
   ══════════════════════════════════════════════════════════════════════════ */
function initReportWizard() {
  if (!document.getElementById('step1')) return;

  let selectedType = null;
  let selectedSev = null;
  let reportMap = null;
  let reportMarker = null;

  // Initialize mini-map on step 2
  function initMiniMap() {
    const el = document.getElementById('reportMap');
    if (!el || reportMap) return;
    reportMap = L.map('reportMap').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; CARTO'
    }).addTo(reportMap);
    reportMap.on('click', (e) => {
      document.getElementById('latitude').value = e.latlng.lat.toFixed(6);
      document.getElementById('longitude').value = e.latlng.lng.toFixed(6);
      if (reportMarker) reportMap.removeLayer(reportMarker);
      reportMarker = L.circleMarker(e.latlng, { color: '#e53e3e', fillColor: '#e53e3e', fillOpacity: 0.8, radius: 8 }).addTo(reportMap);
      checkStep2();
    });
  }

  function goTo(step) {
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active', 'done'));
    document.getElementById(`step${step}`).classList.add('active');
    // Update step indicators
    for (let i = 1; i <= 3; i++) {
      const el = document.querySelector(`.step[data-step="${i}"]`);
      if (i < step) el.classList.add('done');
      else if (i === step) el.classList.add('active');
    }
    if (step === 2) { setTimeout(() => { if (reportMap) reportMap.invalidateSize(); else initMiniMap(); }, 50); }
    if (step === 3) updateSummary();
  }

  function updateSummary() {
    const lat = document.getElementById('latitude').value;
    const lng = document.getElementById('longitude').value;
    document.getElementById('sumType').textContent = selectedType || '—';
    document.getElementById('sumSev').textContent = selectedSev || '—';
    document.getElementById('sumLoc').textContent = lat && lng ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : 'Not set';
  }

  function checkStep1() {
    document.getElementById('s1Next').disabled = !(selectedType && selectedSev);
  }
  function checkStep2() {
    const lat = document.getElementById('latitude').value;
    const lng = document.getElementById('longitude').value;
    document.getElementById('s2Next').disabled = !(lat && lng);
  }

  // Type picker
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedType = btn.dataset.type;
      checkStep1();
    });
  });

  // Severity picker
  document.querySelectorAll('.sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sev-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSev = btn.dataset.sev;
      checkStep1();
    });
  });

  document.getElementById('s1Next').addEventListener('click', () => goTo(2));
  document.getElementById('s2Back').addEventListener('click', () => goTo(1));
  document.getElementById('s3Back').addEventListener('click', () => goTo(2));
  document.getElementById('s2Next').addEventListener('click', () => goTo(3));

  // GPS button
  const geoBtn = document.getElementById('geoBtn');
  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return showToast('Geolocation not supported.', 'error');
      geoBtn.disabled = true; geoBtn.textContent = '📡 Locating…';
      const geoStatus = document.getElementById('geoStatus');
      if (geoStatus) { geoStatus.style.display = 'block'; geoStatus.textContent = 'Getting GPS coordinates…'; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          document.getElementById('latitude').value = lat.toFixed(6);
          document.getElementById('longitude').value = lng.toFixed(6);
          geoBtn.disabled = false; geoBtn.textContent = '📍 Auto-Detect My Location (GPS)';
          if (geoStatus) geoStatus.textContent = `✅ Location captured: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          if (reportMap) {
            reportMap.setView([lat, lng], 13);
            if (reportMarker) reportMap.removeLayer(reportMarker);
            reportMarker = L.circleMarker([lat, lng], { color: '#e53e3e', fillColor: '#e53e3e', fillOpacity: 0.8, radius: 8 }).addTo(reportMap);
          }
          checkStep2();
          showToast('📍 Location captured!', 'success');
        },
        () => {
          geoBtn.disabled = false; geoBtn.textContent = '📍 Auto-Detect My Location (GPS)';
          if (geoStatus) geoStatus.textContent = '❌ Could not retrieve location. Enter manually.';
          showToast('Could not retrieve location.', 'error');
        }, { timeout: 10000 }
      );
    });
  }

  // Manual lat/lng watcher
  ['latitude', 'longitude'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', checkStep2);
  });

  // Submit
  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      submitBtn.disabled = true; submitBtn.textContent = '📡 Sending…';
      const payload = {
        disaster_type: selectedType,
        severity: selectedSev,
        description: document.getElementById('description').value.trim() || null,
        latitude: parseFloat(document.getElementById('latitude').value),
        longitude: parseFloat(document.getElementById('longitude').value),
        reporter_name: document.getElementById('reporterName').value.trim() || null,
        reporter_phone: document.getElementById('reporterPhone').value.trim() || null,
      };
      try {
        const res = await fetch(`${API_BASE}/reports/`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Submission failed');
        // Show success state
        document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
        document.getElementById('successState').style.display = 'block';
      } catch (err) {
        showToast(`❌ ${err.message}`, 'error');
        submitBtn.disabled = false; submitBtn.textContent = '🚨 Submit Emergency Report';
      }
    });
  }

  // Report another
  const ratBtn = document.getElementById('reportAnother');
  if (ratBtn) ratBtn.addEventListener('click', () => { location.reload(); });
}

/* ══════════════════════════════════════════════════════════════════════════
   VOLUNTEER PAGE — Stats + enhanced table (volunteer.html)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadVolunteerPage() {
  if (!document.getElementById('volunteersTableWrapper')) return;
  await loadPublicVolunteers();

  // Load volunteer-specific stats
  try {
    const res = await fetch(`${API_BASE}/volunteers/`);
    if (!res.ok) return;
    const vols = await res.json();
    const avail = vols.filter(v => !v.assigned_report_id).length;
    const disp = vols.filter(v => v.assigned_report_id).length;
    const el = (id) => document.getElementById(id);
    if (el('volAvailable')) el('volAvailable').textContent = avail;
    if (el('volDispatched')) el('volDispatched').textContent = disp;
    if (el('volTotal')) el('volTotal').textContent = vols.length;

    // Skill breakdown
    const skillEl = document.getElementById('skillBreakdown');
    if (skillEl) {
      const skills = {};
      vols.forEach(v => { skills[v.skill] = (skills[v.skill] || 0) + 1; });
      if (Object.keys(skills).length === 0) {
        skillEl.innerHTML = '<span>No data yet.</span>';
      } else {
        skillEl.innerHTML = Object.entries(skills).map(([sk, cnt]) => {
          const pct = Math.round((cnt / vols.length) * 100);
          return `<div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="width:90px;color:var(--text-primary);font-weight:600;">${sk}</span>
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:var(--blue);"></div>
            </div>
            <span style="font-family:var(--font-mono);font-size:0.72rem;">${cnt}</span>
          </div>`;
        }).join('');
      }
    }
  } catch (e) { }

  // Search filter for volunteer table
  const volSearch = document.getElementById('volSearch');
  if (volSearch) {
    volSearch.addEventListener('input', () => {
      const q = volSearch.value.toLowerCase();
      document.querySelectorAll('#volunteersTableWrapper tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   ADMIN TAB NAVIGATION
   ══════════════════════════════════════════════════════════════════════════ */
function setupAdminSidebar() {
  const links = document.querySelectorAll('.admin-tab-btn[data-target]');
  if (!links.length) return;
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const target = document.getElementById(link.dataset.target);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD: Alert banners at top
   ══════════════════════════════════════════════════════════════════════════ */
async function loadAlertBanners() {
  const container = document.getElementById('publicAlertBanners');
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/alerts/`);
    if (!res.ok) return;
    const alerts = await res.json();
    container.innerHTML = alerts.slice(0, 3).map(a => {
      const sc = (a.severity || 'info').toLowerCase();
      const cls = sc === 'critical' ? '' : sc === 'warning' ? 'warning' : 'info';
      const icon = sc === 'critical' ? '🔴' : sc === 'warning' ? '🟠' : '🔵';
      return `<div class="alert-banner ${cls}">
        <div style="display:flex;align-items:center;gap:1rem;">
          <span style="font-size:1.1rem;flex-shrink:0;">${icon}</span>
          <div>
            <strong>[${a.severity}] ${a.location}</strong>
            <div class="alert-meta">${a.message}</div>
          </div>
        </div>
        <div class="alert-btns">
          <button class="alert-btn" onclick="this.closest('.alert-banner').remove()">✕ Dismiss</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD: Last updated timestamp
   ══════════════════════════════════════════════════════════════════════════ */
function updateLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour12: false });
}

/* ══════════════════════════════════════════════════════════════════════════
   WEATHER & HAZARD INTELLIGENCE (admin.html — tab-weather)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadWeatherIntel() {
  const panel = document.getElementById('weatherDataPanel');
  if (!panel) return;

  panel.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div>Fetching weather at all active disaster sites…</div>';

  try {
    const res = await fetch(`${API_BASE}/weather/disasters`);
    if (!res.ok) throw new Error('Failed to fetch');
    const disasters = await res.json();

    if (!disasters.length) {
      panel.innerHTML = `<p style="color:var(--text-secondary);padding:1rem;">No active disasters to monitor. Weather data will appear here once incidents are reported.</p>`;
      return;
    }

    const hazColor = (lvl) => lvl === 'CRITICAL' ? 'var(--danger)' : lvl === 'HIGH' ? 'var(--warning)' : lvl === 'ELEVATED' ? 'var(--info)' : 'var(--success)';
    const hazIcon  = (lvl) => lvl === 'CRITICAL' ? '🔴' : lvl === 'HIGH' ? '🟠' : lvl === 'ELEVATED' ? '🟡' : '🟢';

    const cards = disasters.map(d => `
      <div class="weather-stat-card" style="text-align:left;padding:1.25rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
          <div>
            <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;">Report #${d.report_id}</div>
            <div style="font-size:1rem;font-weight:800;margin-top:0.15rem;">${d.disaster_type}</div>
            <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.1rem;">${d.description ? d.description.slice(0,70) + (d.description.length > 70 ? '…' : '') : '—'}</div>
          </div>
          <span style="font-size:1.4rem;">${hazIcon(d.hazard_level)}</span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.75rem;">
          <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.5rem;text-align:center;">
            <div style="font-size:1.1rem;font-weight:700;">${d.temperature_c != null ? d.temperature_c + '°' : '—'}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;">Temp</div>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.5rem;text-align:center;">
            <div style="font-size:1.1rem;font-weight:700;">${d.wind_speed_kmh != null ? d.wind_speed_kmh : '—'}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;">km/h Wind</div>
          </div>
          <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.5rem;text-align:center;">
            <div style="font-size:1.1rem;font-weight:700;">${d.rain_mm != null ? d.rain_mm + 'mm' : '—'}</div>
            <div style="font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;">Rain</div>
          </div>
        </div>

        <div style="font-size:0.75rem;padding:0.4rem 0.6rem;border-radius:4px;background:rgba(255,255,255,0.04);border-left:2px solid ${hazColor(d.hazard_level)};color:var(--text-secondary);">
          ${d.weather_description} &nbsp;|&nbsp; ${d.hazard_message}
        </div>
      </div>
    `).join('');

    panel.innerHTML = `
      <div style="margin-bottom:0.75rem;font-size:0.8rem;color:var(--text-muted);">
        🌐 Showing live weather at <strong style="color:var(--text-primary);">${disasters.length} active disaster site${disasters.length !== 1 ? 's' : ''}</strong> — fetched in real-time from Open-Meteo API
      </div>
      <div class="weather-stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">
        ${cards}
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-top:1rem;text-align:right;">
        Source: Open-Meteo API (free, no key required) · Auto-refreshes with dashboard
      </div>
    `;
  } catch(e) {
    panel.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load weather data. Check backend connection.</p>';
  }
}


/* ══════════════════════════════════════════════════════════════════════════
   CAMP SUPPLY INVENTORY (admin.html — inside tab-camps)
   ══════════════════════════════════════════════════════════════════════════ */
async function loadCampResources() {
  const wrap = document.getElementById('adminResourcesTableWrapper');
  if (!wrap) return;

  try {
    const [resRes, campRes] = await Promise.all([
      fetch(`${API_BASE}/resources/`),
      fetch(`${API_BASE}/camps/`)
    ]);
    const resources = resRes.ok ? await resRes.json() : [];
    const camps = campRes.ok ? await campRes.json() : [];
    const campMap = {};
    camps.forEach(c => campMap[c.id] = c.camp_name);

    // Populate camp selector
    const sel = document.getElementById('resCampId');
    if (sel && sel.options.length <= 1) {
      camps.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.camp_name;
        sel.appendChild(opt);
      });
    }

    if (resources.length === 0) {
      wrap.innerHTML = '<p style="padding:1rem;color:var(--text-secondary)">No supplies tracked yet. Add supplies using the form above.</p>';
      return;
    }

    // Group by camp
    const grouped = {};
    resources.forEach(r => {
      const cn = campMap[r.camp_id] || `Camp #${r.camp_id}`;
      if (!grouped[cn]) grouped[cn] = [];
      grouped[cn].push(r);
    });

    const typeIcons = { Food: '🍚', Water: '💧', Medicine: '💊', Shelter: '🏠', Equipment: '⚙️', Blankets: '🛏️', 'Blood Units': '🩸' };

    wrap.innerHTML = Object.entries(grouped).map(([camp, items]) => `
      <div style="margin-bottom:1.25rem;">
        <div style="font-weight:700;font-size:0.9rem;margin-bottom:0.5rem;padding:0.5rem 0.75rem;background:var(--bg-input);border-radius:var(--radius-sm);">
          ⛺ ${camp}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;padding:0 0.5rem;">
          ${items.map(i => `
            <div class="supply-badge">
              <span>${typeIcons[i.resource_type] || '📦'} ${i.resource_type}</span>
              <span style="font-weight:800;">${i.quantity}</span>
              <button class="supply-del-btn" onclick="deleteResource(${i.id})" title="Remove">✕</button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } catch(e) {
    wrap.innerHTML = '<p style="color:var(--danger)">Failed to load supplies.</p>';
  }
}

async function addResource() {
  const campId = document.getElementById('resCampId').value;
  const type = document.getElementById('resType').value;
  const qty = parseInt(document.getElementById('resQty').value) || 0;
  if (!campId || !qty) return showToast('❌ Select a camp and enter quantity.', 'error');

  try {
    const res = await fetch(`${API_BASE}/resources/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ resource_type: type, quantity: qty, camp_id: parseInt(campId) })
    });
    if (!res.ok) throw new Error();
    showToast('✅ Supply added!');
    document.getElementById('resQty').value = '';
    loadCampResources();
  } catch(e) { showToast('Failed to add supply', 'error'); }
}

async function deleteResource(id) {
  if (!confirm('Remove this supply entry?')) return;
  try {
    const res = await fetch(`${API_BASE}/resources/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    if (!res.ok) throw new Error();
    showToast('✅ Supply removed');
    loadCampResources();
  } catch(e) { showToast('Failed to remove', 'error'); }
}

/* ── Load supply info into public dashboard camps tab ───────────────────── */
async function loadPublicCampSupplies() {
  const wrapper = document.getElementById('publicCampsWrapper');
  if (!wrapper) return;
  try {
    const resRes = await fetch(`${API_BASE}/resources/`);
    if (!resRes.ok) return;
    const resources = await resRes.json();
    if (resources.length === 0) return;

    const grouped = {};
    resources.forEach(r => {
      if (!grouped[r.camp_id]) grouped[r.camp_id] = [];
      grouped[r.camp_id].push(r);
    });

    const typeIcons = { Food: '🍚', Water: '💧', Medicine: '💊', Shelter: '🏠', Equipment: '⚙️', Blankets: '🛏️', 'Blood Units': '🩸' };

    // Append supply badges to camp rows
    const rows = wrapper.querySelectorAll('table tbody tr');
    rows.forEach((row, idx) => {
      // Try to match by index to camp_id (imperfect but adequate for demo)
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        // Check if supply col already exists
        if (row.querySelectorAll('.camp-supply-cell').length > 0) return;
        const td = document.createElement('td');
        td.className = 'camp-supply-cell';
        // We'll try matching by checking all camp groups
        const campEntries = Object.entries(grouped);
        const supplyItems = campEntries[idx] ? campEntries[idx][1] : null;
        if (supplyItems) {
          td.innerHTML = supplyItems.map(s => `<span class="supply-mini-badge">${typeIcons[s.resource_type] || '📦'}${s.quantity}</span>`).join(' ');
        } else {
          td.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">—</span>';
        }
        row.appendChild(td);
      }
    });

    // Add header if not present
    const thead = wrapper.querySelector('table thead tr');
    if (thead && !thead.querySelector('.supply-header')) {
      const th = document.createElement('th');
      th.className = 'supply-header';
      th.textContent = 'Supplies';
      thead.appendChild(th);
    }
  } catch(e) {}
}

/* ── Supply Chain Intelligence ───────────────────────────────────────────── */
let lastCriticalSupplyAlerts = [];
async function pollCriticalSupplies() {
  try {
    const res = await fetch(`${API_BASE}/resources/critical`, { headers: getAuthHeader() });
    if (!res.ok) return;
    const alerts = await res.json();
    
    // Show toast for NEW alerts only to avoid spam
    alerts.forEach(alert => {
      const key = `${alert.camp_id}-${alert.resource_type}-${alert.quantity}`;
      if (!lastCriticalSupplyAlerts.includes(key)) {
        showToast(alert.message, 'error');
        lastCriticalSupplyAlerts.push(key);
      }
    });

    // Update the Live Alert Ticker in the Command Center
    const ticker = document.getElementById('alertTicker');
    const tickerText = document.getElementById('tickerText');
    if (alerts.length > 0 && ticker && tickerText) {
      tickerText.innerHTML = `<span style="color:var(--danger);font-weight:bold;">⚠️ LOGISTICS ALERT: ${alerts[0].message}</span>`;
      ticker.classList.remove('hidden');
    }
  } catch (e) { }
}

/* ══════════════════════════════════════════════════════════════════════════
   LIVE DIALOGUE CHAT (Admin & Volunteer)
   ══════════════════════════════════════════════════════════════════════════ */
let lastGpsForChat = { lat: null, lng: null };

async function loadChatMessages() {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  try {
    const res = await fetch(`${API_BASE}/chat/`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error();
    const msgs = await res.json();
    container.innerHTML = msgs.map(renderChatMsg).join('');
    container.scrollTop = container.scrollHeight;
  } catch(e) {
    container.innerHTML = '<p style="color:var(--danger);padding:1rem;">Failed to load chat history.</p>';
  }
}

function renderChatMsg(msg) {
  // Determine if the current tab is the Admin console or Volunteer portal
  const isAdminPortal = document.getElementById('kpiGrid') !== null;
  const volName = localStorage.getItem('dl_vol_name');
  const volUsername = localStorage.getItem('dl_vol_username');
  
  // Tagging logic: @volunteer messaging
  const hasTags = /@\S+/.test(msg.message);
  let isTaggedForMe = false;
  if (!isAdminPortal && hasTags) {
    if (volUsername && msg.message.includes(`@${volUsername}`)) isTaggedForMe = true;
    if (volName && msg.message.includes(`@${volName}`)) isTaggedForMe = true;
    
    // If this is from the admin, has tags, but isn't tagged for US, hide it!
    if (!isTaggedForMe && msg.sender_role === 'admin') {
      return '';
    }
  }

  let isMe = false;
  if (isAdminPortal) {
    // In admin portal, any message from 'admin' is "Me"
    isMe = msg.sender_role === 'admin';
  } else {
    // In volunteer portal, only messages from this specific volunteer are "Me"
    isMe = msg.sender_role === 'volunteer' && (msg.sender_name === volName || msg.sender_name === volUsername);
  }

  // HUB-AND-SPOKE PRIVACY: Volunteers should not see messages from OTHER volunteers
  if (!isAdminPortal && msg.sender_role === 'volunteer' && !isMe) {
    return '';
  }

  const isAdminSender = msg.sender_role === 'admin';
  const roleBadge = isAdminSender && !isMe ? '<span style="color:var(--primary);font-size:0.7rem;vertical-align:top;">(Command)</span>' : '';
  
  let locBadge = '';
  if (msg.latitude && msg.longitude) {
    locBadge = `<a href="https://maps.google.com/?q=${msg.latitude},${msg.longitude}" target="_blank" style="font-size:0.7rem;color:var(--success);text-decoration:none;margin-left:0.5rem;" title="View on Map">📍 ${msg.latitude.toFixed(3)}, ${msg.longitude.toFixed(3)}</a>`;
  }

  const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

  // Style the message bubble based on who sent it and if we are tagged
  const bubbleBg = isMe ? 'var(--primary)' : (isTaggedForMe ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.08)');
  const borderCss = isTaggedForMe ? 'border-left:3px solid var(--warning);' : '';

  return `
    <div style="display:flex;flex-direction:column;align-items:${isMe ? 'flex-end' : 'flex-start'};">
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.15rem;display:flex;align-items:center;gap:0.3rem;">
        ${!isMe ? `<strong>${msg.sender_name}</strong> ${roleBadge}` : 'You'} <span style="font-size:0.65rem;">${time}</span> ${locBadge}
      </div>
      <div style="max-width:85%;padding:0.6rem 0.85rem;border-radius:var(--radius-sm);background:${bubbleBg};color:#fff;line-height:1.4;${borderCss}">
        ${msg.message}
      </div>
    </div>
  `;
}

function initChat() {
  const form = document.getElementById('chatForm');
  if (!form) return;
  
  loadChatMessages();
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    
    // Quick send UI
    input.disabled = true;
    try {
      const payload = { 
        message: msg, 
        latitude: lastGpsForChat.lat, 
        longitude: lastGpsForChat.lng 
      };
      
      const res = await fetch(`${API_BASE}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      input.value = '';
    } catch(e) {
      showToast('Failed to send message', 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

function refreshVolGps() {
  const badge = document.getElementById('chatGpsStatus');
  if (!badge) return;
  badge.textContent = 'Acquiring...';
  badge.style.color = 'var(--warning)';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastGpsForChat.lat = pos.coords.latitude;
      lastGpsForChat.lng = pos.coords.longitude;
      badge.textContent = 'GPS Active';
      badge.style.color = 'var(--success)';
    },
    (err) => {
      badge.textContent = 'GPS Failed';
      badge.style.color = 'var(--danger)';
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

/* ── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;

  // Tabs (dashboard page)
  setupTabs('publicTabs');

  // Home page (index.html) — live stats + WebSocket for real-time updates
  if (document.getElementById('homeStatGrid')) {
    loadHomeDashboard();
    setupWebSocket(); // Connect so COMPLETED volunteer events refresh the home page
    setInterval(() => loadHomeDashboard(), 10000);
  }

  // Quick SOS Button
  const btnSos = document.getElementById('btnQuickSos');
  if (btnSos) {
    btnSos.addEventListener('click', () => {
      btnSos.disabled = true;
      btnSos.innerHTML = '<span class="spinner" style="width:1.5rem;height:1.5rem;border-color:#fff;border-bottom-color:transparent;"></span>';
      
      if (!navigator.geolocation) {
        showToast('Geolocation not supported by this browser.', 'error');
        btnSos.disabled = false; btnSos.innerHTML = '🚨';
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const res = await fetch(`${API_BASE}/reports/sos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude
              })
            });
            if (!res.ok) throw new Error();
            showToast('🚨 SOS ALERT SENT TO COMMAND CENTER!', 'success');
          } catch(e) {
            showToast('Failed to send SOS. Check network', 'error');
          } finally {
            btnSos.disabled = false;
            btnSos.innerHTML = '🚨';
          }
        },
        (err) => {
          showToast('Could not retrieve GPS for SOS!', 'error');
          btnSos.disabled = false; btnSos.innerHTML = '🚨';
        },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  // Report wizard (report.html)
  if (document.getElementById('step1')) {
    initReportWizard();
  } else if (document.getElementById('reportForm')) {
    // Fallback for old form if it exists
    initReportForm();
  }

  // Public Dashboard (dashboard.html)
  if (document.getElementById('publicKpiGrid')) {
    loadPublicDashboard();
    loadAlertBanners();
    updateLastUpdated();
    setupWebSocket();
    // Load supply data after a slight delay to let camp data render first
    setTimeout(() => loadPublicCampSupplies(), 1500);
    setInterval(() => { loadPublicDashboard(); updateLastUpdated(); }, 8000);
  }

  // Volunteer page (volunteer.html)
  if (document.getElementById('volunteersTableWrapper') && !document.getElementById('publicKpiGrid')) {
    loadVolunteerPage();
    initVolunteerForm();
  }

  // Admin (admin.html)
  if (document.getElementById('kpiGrid')) {
    initAdminAuth();
    initAdminForms();
    setupAdminSidebar();
    
    // Start automated supply chain intelligence polling
    pollCriticalSupplies();
    setInterval(pollCriticalSupplies, 15000);
    
    // Start AI Forecasting Engine
    loadAiForecasts();
    setInterval(loadAiForecasts, 30000);
  }

  // Hook up WebSockets for Admin and Volunteer panels
  if (document.getElementById('kpiGrid') || (document.getElementById('volunteersTableWrapper') && !document.getElementById('publicKpiGrid'))) {
    setupWebSocket();
  }

  // Chat initialization
  if (document.getElementById('chatCard')) {
    initChat();
    // Pre-fetch GPS for volunteers if possible
    if (document.getElementById('chatGpsStatus')) {
      refreshVolGps();
    }
  }
});

/* ── Proactive AI Forecasts ─────────────────────────────────────────────── */
async function loadAiForecasts() {
  const panel = document.getElementById('weatherDataPanel');
  if (!panel) return;
  try {
    const req = await fetch(`${API_BASE}/reports`);
    if (!req.ok) throw new Error();
    const allReports = await req.json();
    const active = allReports.filter(r => r.status !== 'Resolved').slice(0, 3);
    
    if (active.length === 0) {
      panel.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">✅ No active disasters requiring AI forecasting.</p>';
      return;
    }
    
    let html = '';
    for (const r of active) {
      const pRes = await fetch(`${API_BASE}/weather/predict?disaster_type=${encodeURIComponent(r.disaster_type)}&lat=${r.latitude}&lon=${r.longitude}`);
      if (!pRes.ok) continue;
      const pred = await pRes.json();
      
      const isCritical = pred.ai_prediction.includes('CRITICAL RISK');
      const badgeColor = isCritical ? 'var(--danger)' : 'var(--primary)';
      
      html += `
        <div style="background:rgba(255,255,255,0.03);border-left:4px solid ${badgeColor};padding:1.25rem;margin-bottom:1rem;border-radius:4px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
            <strong style="color:#fff;font-size:1rem;">${r.disaster_type} (Inc #${r.id})</strong>
            <span style="font-size:0.8rem;color:var(--warning);font-weight:bold;background:rgba(245,158,11,0.1);padding:0.2rem 0.5rem;border-radius:4px;">
              💨 ${pred.wind_speed_kmh} km/h ${pred.wind_direction}
            </span>
          </div>
          <div style="font-size:0.9rem;color:var(--text-secondary);line-height:1.5;">
            ${pred.ai_prediction}
          </div>
        </div>
      `;
    }
    panel.innerHTML = html || '<p>No AI predictions available.</p>';
  } catch (e) {
    panel.innerHTML = '<p style="color:var(--danger)">AI Engine offline or unreachable.</p>';
  }
}
