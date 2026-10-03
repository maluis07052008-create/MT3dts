import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { unzipSync, strFromU8 } from "three/addons/libs/fflate.module.js";

// TROQUE: dados da sua loja
const NOME = "MT3D";
const WHATSAPP = "5516993501806";      // código do país + DDD + número, só dígitos
const INSTAGRAM = "mt_3dts";           // sem o @
const EMAIL = "Maluis07052008@gmail.com";

// Os produtos ficam no arquivo produtos.json. Para adicionar, editar ou remover,
// use o painel em /admin/ (aberto pelo Live Server, no seu computador).
let PRODUTOS = [];
try {
  const r = await fetch("produtos.json", { cache: "no-store" });
  if (r.ok) PRODUTOS = (await r.json()).filter((p) => p.visivel !== false);
} catch { /* sem produtos */ }

// TROQUE: fotos dos seus trabalhos. Coloque as imagens na pasta "fotos" e use "fotos/nome.jpg".
const GALERIA = [
  { legenda: "Protótipo sob encomenda", foto: null },
  { legenda: "Peças de reposição", foto: null },
  { legenda: "Presentes personalizados", foto: null },
  { legenda: "Decoração", foto: null },
];

const EXEMPLOS = [
  () => new THREE.TorusKnotGeometry(0.8, 0.28, 160, 24),
  () => new THREE.IcosahedronGeometry(1, 1),
  () => new THREE.CylinderGeometry(0.8, 0.6, 1.4, 6),
  () => new THREE.OctahedronGeometry(1, 0),
];

const $ = (id) => document.getElementById(id);
const link = (t) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(t)}`;
const reais = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const DICA = "Arraste para girar, role para ampliar";
const aviso = (t) => { $("dica").textContent = t; };

// --- Cena 3D ---
const el = $("viewer");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
el.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(3, 2.2, 4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
const sol = new THREE.DirectionalLight(0xffffff, 2);
sol.position.set(4, 6, 5);
scene.add(sol);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
controls.autoRotateSpeed = 1.2;
controls.addEventListener("start", () => { controls.autoRotate = false; });

function ajustar() {
  const { clientWidth: w, clientHeight: h } = el;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(ajustar).observe(el);
ajustar();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

let objeto = null;

// Coloca um objeto 3D na cena, centralizado e do tamanho certo.
// Arquivos de impressão 3D (.3mf e .stl) têm o eixo Z para cima, então giramos a peça.
function colocar(obj, zParaCima = true) {
  if (objeto) { scene.remove(objeto); objeto.traverse((o) => o.geometry && o.geometry.dispose()); }
  const girar = new THREE.Group();
  girar.add(obj);
  if (zParaCima) girar.rotation.x = -Math.PI / 2;
  girar.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(girar);
  const t = caixa.getSize(new THREE.Vector3());
  girar.position.sub(caixa.getCenter(new THREE.Vector3()));
  objeto = new THREE.Group();
  objeto.add(girar);
  objeto.scale.setScalar(2.4 / Math.max(t.x, t.y, t.z));
  scene.add(objeto);
}

// Pinta o modelo: usa as cores definidas no Bambu Studio e, se o arquivo não tiver, a cor do produto
function pintar(obj, cor, forcar = false) {
  obj.traverse((o) => {
    if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: (forcar ? cor : o.userData.cor) || cor, roughness: 0.55, metalness: 0.05 });
  });
  return obj;
}

// Lê um arquivo .3mf (Bambu Lab) ou .stl a partir dos dados dele
function lerModelo(dados, nome, cor, forcar = false) {
  const obj = nome.toLowerCase().endsWith(".3mf")
    ? ler3mf(dados)
    : new THREE.Mesh(new STLLoader().parse(dados));
  return pintar(obj, cor, forcar);
}

// Leitor de .3mf feito para os arquivos do Bambu Studio, que guardam as peças
// em arquivos internos (3D/Objects/*.model) ligados ao arquivo principal.
function ler3mf(dados) {
  const zip = unzipSync(new Uint8Array(dados));
  const docs = {};
  const doc = (caminho) => {
    const nome = caminho.replace(/^\//, "");
    if (!docs[nome]) {
      const chave = Object.keys(zip).find((k) => k.toLowerCase() === nome.toLowerCase());
      if (!chave) throw new Error(`falta ${nome} dentro do arquivo`);
      docs[nome] = new DOMParser().parseFromString(strFromU8(zip[chave]), "application/xml");
    }
    return docs[nome];
  };
  const PRINCIPAL = "3D/3dmodel.model";

  // Cores do Bambu Studio: lista de filamentos e qual filamento cada peça usa
  const texto = (nome) => {
    const k = Object.keys(zip).find((x) => x.toLowerCase() === nome.toLowerCase());
    return k ? strFromU8(zip[k]) : null;
  };
  let cores = [];
  try { cores = JSON.parse(texto("Metadata/project_settings.config")).filament_colour || []; } catch { /* sem cores */ }
  const extrusores = {};
  try {
    const x = new DOMParser().parseFromString(texto("Metadata/model_settings.config"), "application/xml");
    for (const o of x.getElementsByTagName("object")) {
      const info = { padrao: null, partes: {} };
      for (const m of o.children) {
        if (m.tagName === "metadata" && m.getAttribute("key") === "extruder") info.padrao = +m.getAttribute("value");
      }
      for (const p of o.getElementsByTagName("part")) {
        for (const m of p.getElementsByTagName("metadata")) {
          if (m.getAttribute("key") === "extruder") info.partes[p.getAttribute("id")] = +m.getAttribute("value");
        }
      }
      extrusores[o.getAttribute("id")] = info;
    }
  } catch { /* sem cores */ }

  // A matriz do 3MF tem a translação nos três últimos números
  const matriz = (texto) => {
    const m = new THREE.Matrix4();
    if (texto) {
      const v = texto.trim().split(/\s+/).map(Number);
      m.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
    }
    return m;
  };

  function geometria(o) {
    const v = [...o.getElementsByTagName("vertex")].map((e) =>
      [+e.getAttribute("x"), +e.getAttribute("y"), +e.getAttribute("z")]);
    const pos = [];
    for (const t of o.getElementsByTagName("triangle")) {
      for (const k of ["v1", "v2", "v3"]) pos.push(...v[+t.getAttribute(k)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  function montar(arquivo, id, item) {
    const o = [...doc(arquivo).getElementsByTagName("object")].find((x) => x.getAttribute("id") === id);
    if (!o) throw new Error(`objeto ${id} não encontrado`);
    const grupo = new THREE.Group();
    if (o.getElementsByTagName("mesh").length) {
      const malha = new THREE.Mesh(geometria(o));
      const info = extrusores[item] || { partes: {} };
      const n = info.partes[id] ?? info.padrao;
      if (n && cores[n - 1]) malha.userData.cor = cores[n - 1];
      grupo.add(malha);
    }
    for (const c of o.getElementsByTagName("component")) {
      const sub = montar(c.getAttribute("p:path") || arquivo, c.getAttribute("objectid"), item);
      sub.applyMatrix4(matriz(c.getAttribute("transform")));
      grupo.add(sub);
    }
    return grupo;
  }

  const raiz = new THREE.Group();
  for (const item of doc(PRINCIPAL).getElementsByTagName("item")) {
    const parte = montar(PRINCIPAL, item.getAttribute("objectid"), item.getAttribute("objectid"));
    parte.applyMatrix4(matriz(item.getAttribute("transform")));
    raiz.add(parte);
  }
  if (!raiz.children.length) throw new Error("nenhuma peça encontrada");
  return raiz;
}

async function baixar(url, cor, forcar = false) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("arquivo não encontrado");
  return lerModelo(await r.arrayBuffer(), url, cor, forcar);
}

// --- Produtos e categorias ---
let atual = 0;
let filtro = "Todos";

let corAtual = 0;
let vista = "3d";

const corEscolhida = (p) => p.cores && p.cores[corAtual];
const mensagemCompra = (p) => `Olá! Quero comprar: ${p.nome}${corEscolhida(p) ? ` na cor ${corEscolhida(p).nome}` : ""}.`;

// Troca a cor da peça sem recarregar o arquivo
function pintarAtual(p) {
  const c = corEscolhida(p);
  if (c && objeto) objeto.traverse((o) => { if (o.isMesh) o.material.color.set(c.hex); });
}

function desenharCores(p) {
  const el = $("cores");
  el.innerHTML = "";
  (p.cores || []).forEach((c, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(k === corAtual));
    b.innerHTML = `<i style="background:${c.hex}"></i>`;
    b.append(c.nome);
    b.addEventListener("click", () => {
      corAtual = k;
      pintarAtual(p);
      $("comprar").href = link(mensagemCompra(p));
      el.querySelectorAll("button").forEach((x, n) => x.setAttribute("aria-pressed", String(n === k)));
    });
    el.appendChild(b);
  });
}

// Alterna entre o 3D e as fotos do produto
function mostrarVista(v, p) {
  vista = v;
  const emFoto = v !== "3d";
  $("foto").hidden = !emFoto;
  if (emFoto) $("foto").src = v;
  $("dica").hidden = emFoto;
  const m = $("miniaturas");
  m.innerHTML = "";
  const fotos = p.fotos || [];
  if (!fotos.length) return;
  const botao = (alvo, conteudo) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(vista === alvo));
    b.append(conteudo);
    b.addEventListener("click", () => mostrarVista(alvo, p));
    m.appendChild(b);
  };
  if (p.modelo) botao("3d", "3D");
  fotos.forEach((f) => { const im = new Image(); im.src = f; im.alt = "Foto do produto"; botao(f, im); });
}

async function selecionar(i) {
  atual = i;
  corAtual = 0;
  const p = PRODUTOS[i];
  $("nome").textContent = p.nome;
  $("descricao").textContent = p.descricao || "";
  $("preco").textContent = reais(p.preco);
  $("comprar").href = link(mensagemCompra(p));
  desenharLista();
  desenharCores(p);
  aviso(DICA);
  const soFotos = !p.modelo && p.fotos && p.fotos.length;
  mostrarVista(soFotos ? p.fotos[0] : "3d", p);
  if (soFotos) return;

  // Se você cadastrou cores, elas valem mais que as do arquivo; senão usa as do Bambu Studio
  const fallback = (p.cores && p.cores[0] && p.cores[0].hex) || p.cor || "#E50000";
  const forcar = !!(p.cores && p.cores.length);
  if (p.modelo) {
    try {
      const obj = await baixar(p.modelo, fallback, forcar);
      if (atual === i) colocar(obj);
      return;
    } catch (e) {
      console.error(e);
      aviso(`Não consegui abrir ${p.modelo} (${e.message}). Mostrando um exemplo.`);
    }
  }
  colocar(pintar(new THREE.Mesh(EXEMPLOS[i % EXEMPLOS.length]()), fallback, true), false);
}

function desenharLista() {
  $("lista").innerHTML = "";
  PRODUTOS.forEach((p, i) => {
    if (filtro !== "Todos" && p.categoria !== filtro) return;
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(i === atual));
    const capa = p.fotos && p.fotos[0]
      ? `<img class="capa" src="${p.fotos[0]}" alt="">`
      : `<span class="cor" style="background:${(p.cores && p.cores[0] && p.cores[0].hex) || p.cor || "#E50000"}"></span>`;
    b.innerHTML = `${capa}<strong>${p.nome}</strong><small>${p.categoria}</small>${reais(p.preco)}`;
    b.addEventListener("click", () => { selecionar(i); window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("lista").appendChild(b);
  });
}

function desenharChips() {
  const cats = ["Todos", ...new Set(PRODUTOS.map((p) => p.categoria))];
  cats.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c;
    b.setAttribute("aria-pressed", String(c === filtro));
    b.addEventListener("click", () => {
      filtro = c;
      $("chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      desenharLista();
    });
    $("chips").appendChild(b);
  });
}

// --- Galeria ---
GALERIA.forEach((g) => {
  const f = document.createElement("figure");
  f.innerHTML = (g.foto ? `<img src="${g.foto}" alt="${g.legenda}">` : `<div class="vazio"></div>`) +
                `<figcaption>${g.legenda}</figcaption>`;
  $("galeria-lista").appendChild(f);
});

// --- Pedido personalizado: abre o WhatsApp com os dados preenchidos ---
$("pedido").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const linhas = [
    "Olá! Quero um orçamento de impressão 3D.",
    `Nome: ${f.get("nome")}`,
    `O que imprimir: ${f.get("ideia")}`,
    `Material: ${f.get("material")}`,
    `Tamanho aproximado: ${f.get("tamanho") || "não sei"}`,
  ];
  const arq = f.get("arquivo");
  if (arq && arq.name) linhas.push(`Arquivo: ${arq.name} (envio em seguida)`);
  window.open(link(linhas.join("\n")), "_blank");
});

// --- Testar um arquivo seu: arraste um .3mf ou .stl para cima do visualizador ---
el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("arrastando"); });
el.addEventListener("dragleave", () => el.classList.remove("arrastando"));
el.addEventListener("drop", async (e) => {
  e.preventDefault();
  el.classList.remove("arrastando");
  const a = e.dataTransfer.files[0];
  if (!a || !/\.(3mf|stl)$/i.test(a.name)) { aviso("Solte um arquivo .3mf ou .stl"); return; }
  try {
    colocar(lerModelo(await a.arrayBuffer(), a.name, "#E50000"));
    aviso(`Visualizando ${a.name}`);
  } catch (e) {
    console.error(e);
    aviso(`Não consegui ler esse arquivo (${e.message}).`);
  }
});

// --- Dados da loja ---
document.title = NOME;
$("rodape").textContent = `© ${new Date().getFullYear()} ${NOME}`;
$("c-whats").href = link("Olá! Vim pelo site e quero saber mais.");
$("c-insta").href = `https://instagram.com/${INSTAGRAM}`;
$("c-insta").textContent = `Instagram @${INSTAGRAM}`;
$("c-email").href = `mailto:${EMAIL}`;
$("c-email").textContent = EMAIL;

desenharChips();
if (PRODUTOS.length) selecionar(0);
else $("nome").textContent = "Em breve";
