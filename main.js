import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import * as satellite from 'https://cdn.jsdelivr.net/npm/satellite.js@4.1.1/dist/satellite.esm.js';
import { WINDY_API_KEY, SAMPLE_SATS, N2YO_API_KEY } from './config.js';

// === GLOBALS ===
let scene, camera, renderer, controls;
let wireframe;
let satellites = [];

// === AUTHENTICATION ===
window.authenticate = function() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if (user && pass) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('command-center').style.display = 'block';
        initGlobe();
        initTabs();
    } else {
        alert('ACCESS DENIED: INVALID CREDENTIALS');
    }
};
// expose a module-scoped alias so modules can call `authenticate()` directly
const authenticate = window.authenticate;

// === TAB SWITCHING ===
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const view = tab.getAttribute('data-view');
            if (view === 'satellite') {
                document.getElementById('satellite-view').style.display = 'block';
                document.getElementById('camera-viewer').style.display = 'none';
                document.getElementById('satellite-sidebar').style.display = 'block';
            } else {
                document.getElementById('satellite-view').style.display = 'none';
                document.getElementById('camera-viewer').style.display = 'block';
                document.getElementById('satellite-sidebar').style.display = 'none';
                initCameraMap();
            }
        });
    });
}

// === THREE.JS GLOBE (ES MODULES) ===
function initGlobe() {
    const container = document.getElementById('globe-canvas');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 3;

    renderer = new THREE.WebGLRenderer({ canvas: container, antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Monochrome Wireframe Globe
    const globeGeometry = new THREE.SphereGeometry(1, 64, 64);
    const wireframeGeo = new THREE.WireframeGeometry(globeGeometry);
    const line = new THREE.LineSegments(wireframeGeo);
    line.material.color.setHex(0x00ffff);
    line.material.opacity = 0.3;
    line.material.transparent = true;
    scene.add(line);
    wireframe = line;

    // Lighting
    scene.add(new THREE.AmbientLight(0x404040, 0.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(5, 3, 5);
    scene.add(dirLight);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Atmosphere
    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.01, 64, 64),
        new THREE.MeshPhongMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide
        })
    );
    scene.add(atmosphere);

    window.addEventListener('resize', onWindowResize);
    animate();
    loadSatellites();
}

function onWindowResize() {
    const container = document.getElementById('globe-canvas');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    if (wireframe) wireframe.rotation.y += 0.0005;
    updateSatellites();
    renderer.render(scene, camera);
}

// === SATELLITE TRACKING ===
async function loadSatellites() {
    try {
        const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle');
        const tleData = await response.text();
        const tles = tleData.trim().split('\n');

        const satList = document.getElementById('sat-list');
        satList.innerHTML = '';

        let loaded = 0;
        for (let i = 0; i < tles.length && loaded < SAMPLE_SATS; i += 3) {
            if (tles[i+1] && tles[i+2]) {
                const satrec = satellite.twoline2satrec(tles[i+1], tles[i+2]);
                const name = tles[i].trim();

                const geometry = new THREE.SphereGeometry(0.005, 8, 8);
                const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
                const mesh = new THREE.Mesh(geometry, material);
                scene.add(mesh);

                const pathGeometry = new THREE.BufferGeometry();
                const pathMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.3, transparent: true });
                const pathLine = new THREE.Line(pathGeometry, pathMaterial);
                scene.add(pathLine);

                const details = await fetchSatDetails(satrec.satnum);

                const li = document.createElement('li');
                li.className = 'sat-item';
                li.innerHTML = `
                    <div class="sat-name">${name}</div>
                    <div class="sat-norad">NORAD: ${satrec.satnum}</div>
                    <div class="sat-status"></div>
                `;
                li.onclick = () => showSatInfo(name, satrec, details);
                satList.appendChild(li);

                satellites.push({ name, satrec, mesh, pathLine, details });
                loaded++;
            }
        }

        document.getElementById('tle-epoch').textContent = new Date().toISOString().slice(0, 16);
        updateStatusBar();
    } catch (e) {
        console.error(e);
        alert('Failed to load satellites. Check connection.');
    }
}

async function fetchSatDetails(noradId) {
    try {
        const res = await fetch(`https://www.n2yo.com/rest/v1/satellite/details/${noradId}/0/0/0/1/&apiKey=${N2YO_API_KEY}`);
        if (res.ok) {
            const data = await res.json();
            const info = data.satellite;
            return {
                owner: info.country || 'Unknown',
                purpose: info.description || 'Unknown',
                freq: 'N/A',
                launch: info.launchDate,
                link: `https://www.n2yo.com/satellite/?s=${noradId}`
            };
        }
    } catch (e) { }
    return { owner: 'Unknown', purpose: 'Unknown', freq: 'N/A', launch: 'Unknown', link: `https://www.n2yo.com/satellite/?s=${noradId}` };
}

function updateSatellites() {
    const now = new Date();
    satellites.forEach(sat => {
        if (!sat.satrec) return;
        const posVel = satellite.propagate(sat.satrec, now);
        if (posVel.position) {
            const gmst = satellite.gstime(now);
            const gd = satellite.eciToGeodetic(posVel.position, gmst);
            const lat = satellite.radiansToDegrees(gd.latitude);
            const lng = satellite.radiansToDegrees(gd.longitude);
            const pos = latLngToVector3(lat, lng, 1.01 + gd.height / 6371 * 0.1);
            sat.mesh.position.copy(pos);

            const positions = [];
            for (let m = 0; m <= 30; m++) {
                const future = new Date(now.getTime() + m * 1800000);
                const pv = satellite.propagate(sat.satrec, future);
                if (pv.position) {
                    const g = satellite.eciToGeodetic(pv.position, satellite.gstime(future));
                    const p = latLngToVector3(
                        satellite.radiansToDegrees(g.latitude),
                        satellite.radiansToDegrees(g.longitude),
                        1.01 + g.height / 6371 * 0.1
                    );
                    positions.push(p.x, p.y, p.z);
                }
            }
            sat.pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        }
    });
}

function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    return new THREE.Vector3(x, y, z);
}

function showSatInfo(name, satrec, details) {
    document.querySelectorAll('.sat-item').forEach(item => item.classList.remove('active'));
    event.target.closest('.sat-item').classList.add('active');

    const panel = document.getElementById('sat-info-panel');
    document.getElementById('info-sat-name').textContent = name;
    document.getElementById('info-body').innerHTML = `
        <div class="info-row"><span class="info-label">Operator</span><span class="info-value">${details.owner}</span></div>
        <div class="info-row"><span class="info-label">Purpose</span><span class="info-value">${details.purpose}</span></div>
        <div class="info-row"><span class="info-label">NORAD ID</span><span class="info-value">${satrec.satnum}</span></div>
        <div class="info-row"><span class="info-label">Frequency</span><span class="info-value">${details.freq}</span></div>
        <div class="info-row"><span class="info-label">Launch Date</span><span class="info-value">${details.launch}</span></div>
        <div class="info-links">
            <a href="${details.link}" target="_blank" class="info-link">N2YO Tracking</a>
            <a href="https://celestrak.org" target="_blank" class="info-link">TLE Source</a>
        </div>
    `;
    panel.style.display = 'block';
}

window.closeInfoPanel = () => {
    document.getElementById('sat-info-panel').style.display = 'none';
    document.querySelectorAll('.sat-item').forEach(i => i.classList.remove('active'));
};
const closeInfoPanel = window.closeInfoPanel;

function updateStatusBar() {
    document.getElementById('sat-count').textContent = satellites.length;
}

// === CAMERA MAP (LEAFLET) ===
let cameraMap;
async function initCameraMap() {
    if (cameraMap) return;
    cameraMap = L.map('camera-map').setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(cameraMap);

    if (WINDY_API_KEY !== 'YOUR_WINDY_API_KEY_HERE') {
        try {
            const res = await fetch(`https://api.windy.com/api/webcams/v2/list/limit=20?key=${WINDY_API_KEY}`);
            const data = await res.json();
            data.result.webcams.forEach(cam => {
                const m = L.marker([cam.location.latitude, cam.location.longitude]).addTo(cameraMap);
                m.bindPopup(`<div class="camera-popup"><div class="camera-title">${cam.title}</div><div class="camera-stream"><img src="${cam.image.current.preview}" style="width:100%;height:100%;object-fit:cover;"></div></div>`, { maxWidth: 400 });
            });
        } catch (e) { addSampleCameras(); }
    } else {
        addSampleCameras();
    }
}

function addSampleCameras() {
    const cams = [
        { lat: -36.8485, lng: 174.7633, name: "Auckland", img: "https://via.placeholder.com/320x180/11151f/00ffff?text=CAM+OFFLINE" },
        { lat: 40.7128, lng: -74.0060, name: "New York", img: "https://via.placeholder.com/320x180/11151f/00ffff?text=CAM+OFFLINE" }
    ];
    cams.forEach(c => {
        const m = L.marker([c.lat, c.lng]).addTo(cameraMap);
        m.bindPopup(`<div class="camera-popup"><div class="camera-title">${c.name}</div><div class="camera-stream"><img src="${c.img}" style="width:100%;height:100%;"></div></div>`);
    });
}

// Enter key login
document.addEventListener('keypress', e => {
    if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') {
        authenticate();
    }
});
