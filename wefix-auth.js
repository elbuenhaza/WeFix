/* ============================================================
   wefix-auth.js  —  Capa de sesión compartida de WeFix MX
   ------------------------------------------------------------
   Incluir en cada página DESPUÉS de los SDK compat de Firebase:

     <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
     <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
     <script src="wefix-auth.js" data-guard="require" data-role="cliente"></script>

   Atributos del <script>:
     data-guard = "require"   -> exige sesión; si no hay, muestra pantalla de login
                  "optional"  -> permite invitados; la página decide qué mostrar (default)
     data-role  = "cliente"   -> portal de clientes (default)
                  "profesional" -> portal profesional

   Cómo usarlo en la página:
     document.addEventListener('wefix:ready', function (e) {
       var user    = e.detail.user;      // null si es invitado
       var profile = e.detail.profile;   // datos de Firestore o null
       // ... pinta la página con estos datos
     });
   o bien:  WeFix.ready(function (user, profile) { ... });

   API pública:  WeFix.user, WeFix.profile, WeFix.auth, WeFix.db,
                 WeFix.logout(), WeFix.ready(cb)
   ============================================================ */
(function () {
  'use strict';

  /* ── Config: ÚNICA fuente de verdad de Firebase ──
     (La apiKey de Firebase Web es pública por diseño; lo que protege
      tus datos son las Reglas de Firestore, no ocultar esta llave.) */
  var firebaseConfig = {
    apiKey:            "AIzaSyAH8WHeBzO_1MJRhm1_Q8MR5-IduPMfmGo",
    authDomain:        "wefix-app-47e08.firebaseapp.com",
    projectId:         "wefix-app-47e08",
    storageBucket:     "wefix-app-47e08.firebasestorage.app",
    messagingSenderId: "785238307326",
    appId:             "1:785238307326:web:098f386f82c333127dd0af"
  };

  /* ── Lee configuración del propio <script> ── */
  var self  = document.currentScript;
  var GUARD = (self && self.getAttribute('data-guard')) || 'optional';
  var ROLE  = (self && self.getAttribute('data-role'))  || 'cliente';

  /* ── Estado interno ── */
  var resolved = false;
  var state    = { user: null, profile: null };
  var readyCbs = [];

  /* ── Estilos del overlay (inyectados, no requieren tocar el HTML) ── */
  var CSS =
    ".wfa-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#f4f4f6;font-family:'Raleway','Segoe UI',sans-serif;padding:20px;}" +
    ".wfa-card{max-width:340px;width:100%;background:#fff;border-radius:20px;padding:34px 26px;text-align:center;box-shadow:0 12px 40px rgba(18,56,83,.15);}" +
    ".wfa-logo{width:64px;height:64px;border-radius:16px;background:#123853;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;color:#fff;font-size:30px;font-weight:800;font-family:'Raleway',sans-serif;position:relative;}" +
    ".wfa-logo::after{content:'';position:absolute;right:11px;bottom:11px;width:10px;height:10px;border-radius:50%;background:#f87171;}" +
    ".wfa-title{font-size:19px;font-weight:700;color:#123853;margin-bottom:8px;}" +
    ".wfa-text{font-size:14px;color:#5b6b7a;line-height:1.5;margin-bottom:22px;}" +
    ".wfa-btn{display:block;width:100%;padding:13px;border-radius:12px;font-size:15px;font-weight:600;border:none;cursor:pointer;margin-bottom:10px;font-family:'Poppins',sans-serif;text-decoration:none;box-sizing:border-box;}" +
    ".wfa-btn-primary{background:#123853;color:#fff;}" +
    ".wfa-btn-ghost{background:transparent;color:#123853;border:1.5px solid #123853;}" +
    ".wfa-link{display:inline-block;margin-top:6px;font-size:13px;color:#8a97a5;text-decoration:underline;cursor:pointer;}" +
    ".wfa-spin{width:38px;height:38px;border:3px solid #dde1e7;border-top-color:#123853;border-radius:50%;margin:0 auto 16px;animation:wfaspin .8s linear infinite;}" +
    "@keyframes wfaspin{to{transform:rotate(360deg)}}";

  function injectStyle() {
    if (document.getElementById('wfa-style')) return;
    var s = document.createElement('style');
    s.id = 'wfa-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* ── Overlay: "verificando sesión" (evita que se vea contenido antes de saber quién eres) ── */
  function showLoading() {
    injectStyle();
    whenBody(function () {
      if (document.getElementById('wfa-overlay')) return;
      var o = document.createElement('div');
      o.className = 'wfa-overlay';
      o.id = 'wfa-overlay';
      o.innerHTML =
        "<div class='wfa-card'><div class='wfa-spin'></div>" +
        "<div class='wfa-text' style='margin-bottom:0'>Verificando tu sesión…</div></div>";
      document.body.appendChild(o);
    });
  }

  /* ── Overlay: se requiere iniciar sesión ── */
  function showLoginGate() {
    injectStyle();
    whenBody(function () {
      var html =
        "<div class='wfa-card'>" +
          "<div class='wfa-logo'>W</div>" +
          "<div class='wfa-title'>Inicia sesión para continuar</div>" +
          "<div class='wfa-text'>Para ver esta sección necesitas una cuenta WeFix MX. Es gratis y toma menos de un minuto.</div>" +
          "<a class='wfa-btn wfa-btn-primary' href='index.html'>Iniciar sesión</a>" +
          "<a class='wfa-btn wfa-btn-ghost' href='index.html'>Crear una cuenta</a>" +
          "<span class='wfa-link' onclick=\"window.location.href='wefix-home.html'\">Volver a explorar sin cuenta</span>" +
        "</div>";
      var existing = document.getElementById('wfa-overlay');
      if (existing) { existing.innerHTML = html; return; }
      var o = document.createElement('div');
      o.className = 'wfa-overlay';
      o.id = 'wfa-overlay';
      o.innerHTML = html;
      document.body.appendChild(o);
    });
  }

  function hideOverlay() {
    var o = document.getElementById('wfa-overlay');
    if (o && o.parentNode) o.parentNode.removeChild(o);
  }

  function resolve(user, profile) {
    state.user = user;
    state.profile = profile;
    window.wefixUser = user;
    window.wefixProfile = profile;
    resolved = true;
    var detail = { user: user, profile: profile };
    var ev;
    try {
      ev = new CustomEvent('wefix:ready', { detail: detail });
    } catch (e) {
      ev = document.createEvent('CustomEvent');
      ev.initCustomEvent('wefix:ready', true, true, detail);
    }
    document.dispatchEvent(ev);
    readyCbs.forEach(function (cb) { try { cb(user, profile); } catch (e) {} });
    readyCbs = [];
  }

  /* ── Verifica que Firebase esté cargado ── */
  if (typeof firebase === 'undefined' || !firebase.initializeApp) {
    console.error('[wefix-auth] No se encontró Firebase. Incluye los scripts firebase-*-compat.js ANTES de wefix-auth.js.');
    return;
  }

  /* Si la página exige sesión, muestra "cargando" de inmediato para no filtrar contenido */
  if (GUARD === 'require') showLoading();

  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  var auth = firebase.auth();
  var db   = firebase.firestore();

  auth.onAuthStateChanged(function (user) {
    if (user) {
      db.collection('usuarios').doc(user.uid).get().then(function (snap) {
        var profile = snap.exists ? snap.data() : { email: user.email };

        /* Portal equivocado: manda a cada quien a su lado */
        if (ROLE === 'cliente' && profile.rol === 'profesional') {
          window.location.href = 'wefix-empleado-home.html';
          return;
        }
        if (ROLE === 'profesional' && profile.rol && profile.rol !== 'profesional') {
          window.location.href = 'wefix-home.html';
          return;
        }

        hideOverlay();
        resolve(user, profile);
      }).catch(function (e) {
        console.error('[wefix-auth] Error leyendo el perfil:', e);
        hideOverlay();
        resolve(user, { email: user.email });
      });
    } else {
      /* Invitado */
      if (GUARD === 'require') {
        showLoginGate();
        resolve(null, null); /* la página queda cubierta por el overlay */
      } else {
        hideOverlay();
        resolve(null, null);
      }
    }
  });

  /* ── API pública ── */
  window.WeFix = {
    get user()    { return state.user; },
    get profile() { return state.profile; },
    auth: auth,
    db: db,
    logout: function () {
      auth.signOut().then(function () {
        window.location.href = 'index.html';
      });
    },
    ready: function (cb) {
      if (resolved) cb(state.user, state.profile);
      else readyCbs.push(cb);
    }
  };
})();
