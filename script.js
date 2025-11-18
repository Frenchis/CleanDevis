/* ========================== CONFIGURATION ========================== */
const CONFIG = {
    weights: {
        phases: { opr: 4, prelivraison: 3, livraison: 2, vitrerie: 1 },
        typologies: { T1: 1.0, T2: 1.2, T3: 1.5, T4: 1.8, T5: 2.0, Autres: 1.5 }
    },
    api: {
        url: "YOUR_GOOGLE_SCRIPT_DEPLOYMENT_URL" // Placeholder
    }
};

/* ========================== STATE ========================== */
let state = {
    batiments: [
        { nom: 'Bât A', surface: 1193.9, phases: 2 },
        { nom: 'Bât B', surface: 1355.03, phases: 2 },
        { nom: 'Bât C', surface: 1145.97, phases: 2 }
    ],
    chiffrages: [],
    convergence: {},
    prixRecommande: 0,
    ventilation: { vitrerie: {}, opr: {}, prelivraison: {}, livraison: {} }
};

/* ========================== INITIALIZATION ========================== */
document.addEventListener('DOMContentLoaded', () => {
    renderBatiments();
    updateTotalLogements();
    calculer();
    setupEventListeners();
    initExpressVentilation();
});

function setupEventListeners() {
    // Typology Inputs
    document.querySelectorAll('.typologie-input').forEach(input => {
        input.addEventListener('input', updateTotalLogements);
    });

    // Global Calculation Triggers
    const calcTriggers = ['prixJour', 'prixM2Min', 'prixM2Max', 'prixM2Step', 'm2JourValues', 'logementsJourValues'];
    calcTriggers.forEach(id => {
        document.getElementById(id)?.addEventListener('change', calculer);
    });
}

/* ========================== CORE LOGIC ========================== */

// --- Typologies ---
function readTypologyCounts() {
    const counts = {};
    let total = 0;
    document.querySelectorAll('.typologie-input').forEach(input => {
        const qty = parseInt(input.value) || 0;
        total += qty;
        if (qty > 0) counts[input.id.replace('nb', '')] = qty;
    });

    const totalDisplay = document.getElementById('totalUnitesDisplay');
    if (totalDisplay) totalDisplay.textContent = total;

    const totalInput = document.getElementById('nbLogementsTotal');
    if (totalInput) totalInput.value = total;

    return counts;
}

function updateTotalLogements() {
    readTypologyCounts();
    if (document.getElementById('ventilation-details')?.open) {
        refreshVentilation();
    }
    calculer(); // Auto-recalculate on change
}

// --- Batiments ---
function renderBatiments() {
    const tbody = document.getElementById('batimentsBody');
    if (!tbody) return; // Guard clause

    tbody.innerHTML = '';
    let totalSurf = 0, totalSurfPhases = 0;

    state.batiments.forEach((bat, i) => {
        const surfTot = bat.surface * bat.phases;
        totalSurf += bat.surface;
        totalSurfPhases += surfTot;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${bat.nom}</td>
            <td>${bat.surface.toFixed(2)}</td>
            <td>${bat.phases}</td>
            <td>${surfTot.toFixed(2)}</td>
            <td class="text-center">
                <button class="btn btn-danger" onclick="supprimerBatiment(${i})">×</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    const totalSurfEl = document.getElementById('totalSurface');
    if (totalSurfEl) totalSurfEl.textContent = totalSurf.toFixed(2);

    const totalSurfPhasesEl = document.getElementById('totalSurfacePhases');
    if (totalSurfPhasesEl) totalSurfPhasesEl.textContent = totalSurfPhases.toFixed(2);
}

window.ajouterBatiment = function () {
    const nom = prompt('Nom du bâtiment :');
    if (!nom) return;
    const surface = parseFloat(prompt('Surface (m²) :'));
    const phases = parseInt(prompt('Nombre de phases :'));

    if (isNaN(surface) || surface <= 0 || isNaN(phases) || phases <= 0) {
        alert('Valeurs invalides');
        return;
    }

    state.batiments.push({ nom, surface, phases });
    renderBatiments();
    calculer();
};

window.supprimerBatiment = function (index) {
    state.batiments.splice(index, 1);
    renderBatiments();
    calculer();
};

// --- Calcul & Matrices ---
window.calculer = function () {
    const inputs = getCalculationInputs();
    const surfaceTotale = state.batiments.reduce((acc, b) => acc + (b.surface * b.phases), 0);

    // Generate Price Range
    const pricesM2 = [];
    for (let p = inputs.pMin; p <= inputs.pMax; p += inputs.pStep) {
        pricesM2.push(Math.round(p * 100) / 100);
    }
    if (pricesM2.length === 0) pricesM2.push(inputs.pMin);

    // Matrice A (Surface)
    const resA = calculateMatrix(pricesM2, inputs.m2JourValues, surfaceTotale, inputs.prixJour, 'surface');
    renderMatrix('matriceContainerSurface', resA, inputs.m2JourValues, 'm²/j');

    // Matrice B (Logement)
    let resB = null;
    const totalLogementsInput = document.getElementById('nbLogementsTotal');
    const totalLogements = totalLogementsInput ? (parseFloat(totalLogementsInput.value) || 0) : 0;

    if (totalLogements > 0 && inputs.logJourValues.length > 0) {
        const avgPhases = state.batiments.length ? (state.batiments.reduce((a, b) => a + b.phases, 0) / state.batiments.length) : 1;
        const totalUnits = totalLogements * avgPhases;
        resB = calculateMatrix(pricesM2, inputs.logJourValues, totalUnits, inputs.prixJour, 'logement');
        renderMatrix('matriceContainerLogement', resB, inputs.logJourValues, 'log/j');
    } else {
        const containerB = document.getElementById('matriceContainerLogement');
        if (containerB) containerB.innerHTML = '<div class="text-center text-light p-4">Renseignez les typologies pour voir cette matrice</div>';
    }

    // Recommendation
    updateRecommendation(resA.best, resB?.best);

    // Update Ventilation Target
    if (document.getElementById('ventilation-details')?.open) {
        refreshVentilation();
    }
};

function getCalculationInputs() {
    return {
        prixJour: parseFloat(document.getElementById('prixJour')?.value) || 840,
        pMin: parseFloat(document.getElementById('prixM2Min')?.value) || 1,
        pMax: parseFloat(document.getElementById('prixM2Max')?.value) || 4,
        pStep: parseFloat(document.getElementById('prixM2Step')?.value) || 0.25,
        m2JourValues: parseList(document.getElementById('m2JourValues')?.value || ''),
        logJourValues: parseList(document.getElementById('logementsJourValues')?.value || '')
    };
}

function parseList(str) {
    if (!str) return [];
    return str.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v) && v > 0);
}

function calculateMatrix(pricesM2, cadences, totalQuantity, dailyCost, type) {
    let best = { ecart: Infinity, prix: 0, details: '' };
    const rows = pricesM2.map(pm2 => {
        const priceByM2 = totalQuantity * pm2;

        let refPrice = 0;
        if (type === 'surface') {
            refPrice = totalQuantity * pm2;
        } else {
            const surfTot = state.batiments.reduce((acc, b) => acc + (b.surface * b.phases), 0);
            refPrice = surfTot * pm2;
        }

        const cols = cadences.map(cadence => {
            const days = cadence > 0 ? totalQuantity / cadence : Infinity;
            const priceByDay = days * dailyCost;
            const ecart = refPrice > 0 ? Math.abs((priceByDay - refPrice) / refPrice * 100) : Infinity;

            if (ecart < best.ecart) {
                best = { ecart, prix: (priceByDay + refPrice) / 2, details: `${pm2}€/m² vs ${cadence}` };
            }

            return { price: priceByDay, ecart };
        });

        return { pm2, cols };
    });
    return { rows, best };
}

function renderMatrix(containerId, data, headers, unitLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let html = `<table><thead><tr><th>Prix/m²</th>${headers.map(h => `<th>${h} ${unitLabel}</th>`).join('')}</tr></thead><tbody>`;

    data.rows.forEach(row => {
        html += `<tr><td><strong>${row.pm2.toFixed(2)} €</strong></td>`;
        row.cols.forEach(col => {
            const cls = col.ecart <= 10 ? 'cell-excellent' : (col.ecart <= 20 ? 'cell-good' : '');
            html += `<td class="${cls}">
                ${Math.round(col.price).toLocaleString()} €
                <span class="ecart-badge">${col.ecart.toFixed(1)}%</span>
            </td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

function updateRecommendation(bestA, bestB) {
    const prices = [];
    if (bestA && bestA.ecart !== Infinity) prices.push(bestA.prix);
    if (bestB && bestB.ecart !== Infinity) prices.push(bestB.prix);

    const recoEl = document.getElementById('prixRecommande'); // Div on index.html
    const detailEl = document.getElementById('recommandationDetail');
    const targetInput = document.getElementById('ventil-target-input'); // Input on both pages

    if (prices.length > 0) {
        state.prixRecommande = prices.reduce((a, b) => a + b, 0) / prices.length;

        // Update Display Div (Index)
        if (recoEl) recoEl.textContent = Math.round(state.prixRecommande).toLocaleString() + ' €';

        // Update Input Field (Both) - Only if user hasn't manually edited it? 
        // For now, we overwrite on recalc to guide the user.
        if (targetInput) targetInput.value = Math.round(state.prixRecommande);

        const nbLogInput = document.getElementById('nbLogementsTotal');
        const nbLog = nbLogInput ? (parseFloat(nbLogInput.value) || 0) : 0;
        let sub = "";
        if (nbLog > 0) sub = `Soit ~${Math.round(state.prixRecommande / nbLog).toLocaleString()} € / logement`;
        if (detailEl) detailEl.textContent = sub;
    } else {
        state.prixRecommande = 0;
        if (recoEl) recoEl.textContent = '- €';
        if (targetInput) targetInput.value = '';
        if (detailEl) detailEl.textContent = 'Pas de convergence';
    }
}

/* ========================== VENTILATION ========================== */
window.togglePhaseSection = function (phase) {
    refreshVentilation();
};

/* ========================== NEW LOGIC ========================== */

function calculateVentilationFromPage() {
    // 1. Get Target Price
    const targetInput = document.getElementById('ventil-target-input');
    const targetTotal = targetInput ? (parseFloat(targetInput.value) || 0) : 0;

    if (targetTotal <= 0) {
        alert("Veuillez saisir un Montant Global Cible valide.");
        if (targetInput) targetInput.focus();
        return;
    }
    const phases = Array.from(document.querySelectorAll('input[name="phases"]:checked')).map(cb => cb.value);
    if (phases.length === 0) return alert('Sélectionnez des phases');

    const typologies = readTypologyCounts();
    if (Object.keys(typologies).length === 0) return alert('Aucune typologie');
}

window.automateVentilation = function () {
    const total = state.prixRecommande;
    if (total <= 0) return alert('Aucun prix recommandé');

    const phases = Array.from(document.querySelectorAll('input[name="phases"]:checked')).map(cb => cb.value);
    if (phases.length === 0) return alert('Sélectionnez des phases');

    const typologies = readTypologyCounts();
    if (Object.keys(typologies).length === 0) return alert('Aucune typologie');

    // Calculate Phase Totals
    const totalWeight = phases.reduce((acc, p) => acc + CONFIG.weights.phases[p], 0);

    phases.forEach(phase => {
        const phaseAmount = total * (CONFIG.weights.phases[phase] / totalWeight);

        // Distribute to Typologies
        let totalTypoWeight = 0;
        for (const [t, qty] of Object.entries(typologies)) {
            totalTypoWeight += (CONFIG.weights.typologies[t] || 1.5) * qty;
        }

        for (const [t, qty] of Object.entries(typologies)) {
            const weight = CONFIG.weights.typologies[t] || 1.5;
            const share = phaseAmount * (weight * qty) / totalTypoWeight;
            state.ventilation[phase][t] = qty > 0 ? share / qty : 0;
        }
    });

    refreshVentilation();
};

function refreshVentilation() {
    const container = document.getElementById('ventilation-detail-container');
    if (!container) return;

    container.innerHTML = '';

    let typologies = readTypologyCounts();
    // Fallback for display if no typologies but we have data
    if (Object.keys(typologies).length === 0) {
        typologies = { "Ensemble": 1 };
    }

    // 1. Calculate Global Total first
    let globalTotal = 0;
    const phaseTotals = {};

    document.querySelectorAll('input[name="phases"]:checked').forEach(cb => {
        const phase = cb.value;
        let pTotal = 0;
        for (const [t, qty] of Object.entries(typologies)) {
            const uPrice = (state.ventilation[phase] && state.ventilation[phase][t]) || 0;
            pTotal += uPrice * qty;
        }
        phaseTotals[phase] = pTotal;
        globalTotal += pTotal;
    });

    // 2. Render
    document.querySelectorAll('input[name="phases"]:checked').forEach(cb => {
        const phase = cb.value;
        const phaseTotal = phaseTotals[phase];
        const percentage = globalTotal > 0 ? (phaseTotal / globalTotal * 100).toFixed(1) : "0.0";

        const div = document.createElement('div');
        div.className = 'phase-card';

        let rows = '';
        for (const [t, qty] of Object.entries(typologies)) {
            // Ensure we have a value in state, otherwise 0
            const uPrice = (state.ventilation[phase] && state.ventilation[phase][t]) || 0;
            const sub = uPrice * qty;

            rows += `
                <tr>
                    <td>${t} (${qty})</td>
                    <td style="text-align:right">
                        <input type="number" value="${uPrice.toFixed(2)}" 
                            onchange="updateVentilPrice('${phase}', '${t}', this.value)"> €
                    </td>
                    <td style="text-align:right; font-weight:bold">${sub.toLocaleString()} €</td>
                </tr>
            `;
        }

        div.innerHTML = `
            <div class="phase-header">
                <span>${phase.toUpperCase()}</span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:0.9rem; background:var(--gray-100); padding:2px 8px; border-radius:12px; color:var(--gray-600); font-weight:600;">${percentage}%</span>
                    <span>${phaseTotal.toLocaleString()} €</span>
                </div>
            </div>
            <table class="ventilation-table">${rows}</table>
        `;
        container.appendChild(div);
    });

    const targetEl = document.getElementById('ventil-total-cible');
    if (targetEl) targetEl.textContent = Math.round(totalVentilationCible || state.prixRecommande).toLocaleString() + ' €';

    const calcEl = document.getElementById('ventil-total-calcule');
    if (calcEl) calcEl.textContent = Math.round(globalTotal).toLocaleString() + ' €';

    const ecartEl = document.getElementById('ventil-ecart');
    if (ecartEl) {
        const target = totalVentilationCible || state.prixRecommande;
        const diff = globalTotal - target;
        ecartEl.textContent = Math.round(diff).toLocaleString() + ' €';
        ecartEl.style.color = Math.abs(diff) < 5 ? 'green' : 'red';
    }
}

window.updateVentilPrice = function (phase, type, val) {
    state.ventilation[phase][type] = parseFloat(val) || 0;
    refreshVentilation();
};

/* ========================== SAVE/LOAD ========================== */
// Placeholder functions for API interaction
window.sauvegarderProjet = function () {
    alert('Fonctionnalité de sauvegarde à connecter à l\'API Google Script');
};

window.chargerChiffrages = function () {
    alert('Fonctionnalité d\'historique à connecter à l\'API Google Script');
};

/* ========================== VENTILATION EXPRESS ========================== */
function initExpressVentilation() {
    const openBtn = document.getElementById('open-express-modal-btn');
    const closeBtn = document.getElementById('close-express-modal-btn');
    const backdrop = document.getElementById('express-modal-backdrop');
    const cancelBtn = document.getElementById('cancel-express-modal-btn');
    const applyBtn = document.getElementById('apply-express-modal-btn');

    if (openBtn) openBtn.addEventListener('click', openExpressModal);
    if (closeBtn) closeBtn.addEventListener('click', closeExpressModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeExpressModal);
    if (backdrop) backdrop.addEventListener('click', closeExpressModal);
    if (applyBtn) applyBtn.addEventListener('click', applyExpressVentilation);
}

function openExpressModal() {
    // 1. Pre-fill Typologies
    const typologies = readTypologyCounts();
    for (const [typoKey, qty] of Object.entries(typologies)) {
        const input = document.getElementById(`modal-nb${typoKey}`);
        if (input) input.value = qty;
    }

    // 2. Pre-fill Phases (sync with main page)
    document.querySelectorAll('input[name="phases"]:checked').forEach(cb => {
        const modalCb = document.querySelector(`input[name="modal-phases"][value="${cb.value}"]`);
        if (modalCb) modalCb.checked = true;
    });

    // 3. Pre-fill Total Amount (if recommendation exists)
    const currentReco = state.prixRecommande || 0;
    document.getElementById('modal-total-ht').value = currentReco > 0 ? Math.round(currentReco) : '';

    // 4. Show Modal
    const backdrop = document.getElementById('express-modal-backdrop');
    const content = document.getElementById('express-modal-content');

    backdrop.classList.add('show');
    content.classList.add('show');
    content.style.display = 'block'; // Ensure display block for animation
    backdrop.style.display = 'block';
}

function closeExpressModal() {
    const backdrop = document.getElementById('express-modal-backdrop');
    const content = document.getElementById('express-modal-content');

    backdrop.classList.remove('show');
    content.classList.remove('show');

    setTimeout(() => {
        backdrop.style.display = 'none';
        content.style.display = 'none';
    }, 300); // Wait for transition
}

function applyExpressVentilation() {
    // 1. Get Data
    const targetTotal = parseFloat(document.getElementById('modal-total-ht').value) || 0;
    if (targetTotal <= 0) return alert("Veuillez saisir un montant total valide.");

    const phasesCibles = [];
    document.querySelectorAll('input[name="modal-phases"]:checked').forEach(cb => {
        phasesCibles.push(cb.value);
    });
    if (phasesCibles.length === 0) return alert("Veuillez sélectionner au moins une phase.");

    // 2. Sync Quantities from Modal to Main Page
    const modalTypologies = {};
    let hasTypologies = false;
    document.querySelectorAll('.modal-typologie-input').forEach(input => {
        const key = input.id.replace('modal-nb', '');
        const val = parseInt(input.value) || 0;
        modalTypologies[key] = val;
        if (val > 0) hasTypologies = true;

        // Update Main Page Input
        const mainInput = document.getElementById(`nb${key}`);
        if (mainInput) mainInput.value = val;
    });

    if (!hasTypologies) return alert("Aucune typologie définie.");

    // 3. Update Global State (Total Unités)
    updateTotalLogements();

    // 4. Calculate Distribution
    // Logic similar to automateVentilation but with fixed targetTotal
    const totalWeight = phasesCibles.reduce((acc, p) => acc + CONFIG.weights.phases[p], 0);

    // Re-read typologies from main page (now synced) to be safe and consistent with 'readTypologyCounts'
    const typologies = readTypologyCounts();

    phasesCibles.forEach(phase => {
        const phaseAmount = targetTotal * (CONFIG.weights.phases[phase] / totalWeight);

        let totalTypoWeight = 0;
        for (const [t, qty] of Object.entries(typologies)) {
            totalTypoWeight += (CONFIG.weights.typologies[t] || 1.5) * qty;
        }

        for (const [t, qty] of Object.entries(typologies)) {
            const weight = CONFIG.weights.typologies[t] || 1.5;
            const share = phaseAmount * (weight * qty) / totalTypoWeight;
            state.ventilation[phase][t] = qty > 0 ? share / qty : 0;
        }
    });

    // 5. Update Main UI
    // Sync Phases Checkboxes
    document.querySelectorAll('input[name="phases"]').forEach(cb => {
        cb.checked = phasesCibles.includes(cb.value);
    });

    // Force update of ventilation view
    const details = document.getElementById('ventilation-details');
    if (details && !details.open) details.open = true;

    refreshVentilation();
    closeExpressModal();
}

/* ========================== NEW LOGIC ========================== */

function calculateVentilationFromPage() {
    // 1. Get Target Price
    const targetInput = document.getElementById('ventil-target-input');
    const targetTotal = targetInput ? (parseFloat(targetInput.value) || 0) : 0;

    if (targetTotal <= 0) {
        alert("Veuillez saisir un Montant Global Cible valide.");
        if (targetInput) targetInput.focus();
        return;
    }

    // 2. Get Phases
    const phasesCibles = [];
    document.querySelectorAll('input[name="phases"]:checked').forEach(cb => {
        phasesCibles.push(cb.value);
    });

    if (phasesCibles.length === 0) {
        alert("Veuillez sélectionner au moins une phase.");
        return;
    }

    // 3. Get Typologies
    let typologiesCibles = readTypologyCounts();
    const totalUnits = Object.values(typologiesCibles).reduce((a, b) => a + b, 0);

    // Handle "No Typologies" case
    if (totalUnits === 0) {
        typologiesCibles = { "Ensemble": 1 };
    }

    // 4. Calculate
    const success = calculerRepartition(targetTotal, phasesCibles, typologiesCibles);

    if (success) {
        // Update UI
        totalVentilationCible = targetTotal;

        // Ensure sections are open/ready
        phasesCibles.forEach(phase => {
            togglePhaseSection(phase);
        });

        refreshVentilation(); // This needs to handle the "Ensemble" case

        // Visual feedback
        const btn = document.querySelector('.btn-premium-action');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="icon">✅</span><span class="text">Calculé !</span>';
            setTimeout(() => btn.innerHTML = originalText, 2000);
        }
    }
}

function calculerRepartition(targetTotal, phasesCibles, typologiesCibles) {
    const totalWeight = phasesCibles.reduce((acc, p) => acc + (CONFIG.weights.phases[p] || 1), 0);
    if (totalWeight === 0) return false;

    phasesCibles.forEach(phase => {
        const phaseAmount = targetTotal * ((CONFIG.weights.phases[phase] || 1) / totalWeight);

        let totalTypoWeight = 0;
        for (const [t, qty] of Object.entries(typologiesCibles)) {
            // Use 1.5 as default weight if not found (e.g. for "Ensemble")
            totalTypoWeight += (CONFIG.weights.typologies[t] || 1.5) * qty;
        }

        if (totalTypoWeight === 0) totalTypoWeight = 1; // Prevent division by zero

        for (const [t, qty] of Object.entries(typologiesCibles)) {
            const weight = CONFIG.weights.typologies[t] || 1.5;
            const share = phaseAmount * (weight * qty) / totalTypoWeight;

            // Initialize phase object if needed
            if (!state.ventilation[phase]) state.ventilation[phase] = {};

            state.ventilation[phase][t] = qty > 0 ? share / qty : 0;
        }
    });

    return true;
}
