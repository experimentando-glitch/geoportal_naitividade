// ==================== Configuration ====================
const CONFIG = {
    center: [-21.0419, -41.9728], // Natividade coordinates [lat, lng]
    zoom: 12,
    minZoom: 10,
    maxZoom: 18,
    basemaps: {
        streets: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '© OpenStreetMap contributors'
        },
        satellite: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '© Esri'
        },
        terrain: {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors'
        }
    },
    layers: {
        distritos: {
            file: 'data/bairros_nat.geojson',
            color: '#667eea',
            name: 'Distritos'
        },
        setores: {
            file: 'data/setores1_nat.geojson',
            color: '#f093fb',
            name: 'Setores Censitários'
        },
        urb_rur: {
            file: 'data/urb_rur_nat.geojson',
            color: '#4facfe',
            name: 'Urbano / Rural'
        },
        deficit_hab: {
            file: 'data/deficit_hab_nat.geojson',
            color: '#fa709a',
            name: 'Déficit Habitacional'
        },
        residencia: {
            file: 'data/residencias_nat.geojson',
            color: '#43e97b',
            name: 'Residências'
        }
    }
};

// ==================== Global Variables ====================
let map;
let currentBasemap = 'streets';
let basemapLayers = {};
let dataLayers = {};
let loadingIndicator;
let selectedAttributes = new Set(['CD_SETOR', 'NM_MUN', 'NM_DIST', 'AREA_KM2', 'v0001', 'v0002', 'v0007']);

// ==================== Initialize Map ====================
function initMap() {
    // Create map
    map = L.map('map', {
        center: CONFIG.center,
        zoom: CONFIG.zoom,
        minZoom: CONFIG.minZoom,
        maxZoom: CONFIG.maxZoom,
        zoomControl: false,
        attributionControl: true
    });

    // Add initial basemap
    addBasemap('streets');

    // Load data layers
    loadDataLayers();

    // Setup event listeners
    setupEventListeners();
}

// ==================== Basemap Management ====================
function addBasemap(basemapName) {
    // Remove existing basemap
    if (basemapLayers[currentBasemap]) {
        map.removeLayer(basemapLayers[currentBasemap]);
    }

    // Add new basemap
    if (!basemapLayers[basemapName]) {
        const config = CONFIG.basemaps[basemapName];
        basemapLayers[basemapName] = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: CONFIG.maxZoom
        });
    }

    basemapLayers[basemapName].addTo(map);
    currentBasemap = basemapName;

    // Update UI
    document.querySelectorAll('.basemap-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelector(`[data-basemap="${basemapName}"]`).classList.add('active');
}

// ==================== Data Layer Management ====================
async function loadDataLayers() {
    showLoading();

    try {
        // Load distritos layer by default
        await loadLayer('distritos');
        hideLoading();
    } catch (error) {
        console.error('Error loading initial layers:', error);
        hideLoading();
        alert('Erro ao carregar camadas. Verifique o console para mais detalhes.');
    }
}

async function loadLayer(layerName) {
    if (dataLayers[layerName]) {
        return; // Already loaded
    }

    try {
        const config = CONFIG.layers[layerName];
        console.log(`Loading layer: ${layerName} from ${config.file}`);

        const response = await fetch(config.file);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const geojsonData = await response.json();
        console.log(`Layer ${layerName} loaded successfully with ${geojsonData.features?.length || 0} features`);

        // Check if coordinates need reprojection (for deficit_hab layer)
        if (layerName === 'deficit_hab' && geojsonData.features.length > 0) {
            const firstCoord = geojsonData.features[0].geometry.coordinates[0][0][0];

            // If coordinates are very large (> 180), they're likely in UTM projection
            if (Math.abs(firstCoord[0]) > 180) {
                console.log('Reprojecting deficit_hab coordinates from UTM to WGS84...');

                // Define UTM Zone 23S projection (EPSG:31983 - SIRGAS 2000)
                proj4.defs("EPSG:31983", "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

                // Reproject all coordinates
                geojsonData.features.forEach(feature => {
                    if (feature.geometry.type === 'MultiPolygon') {
                        feature.geometry.coordinates = feature.geometry.coordinates.map(polygon =>
                            polygon.map(ring =>
                                ring.map(coord => {
                                    const [lng, lat] = proj4('EPSG:31983', 'EPSG:4326', coord);
                                    return [lng, lat];
                                })
                            )
                        );
                    } else if (feature.geometry.type === 'Polygon') {
                        feature.geometry.coordinates = feature.geometry.coordinates.map(ring =>
                            ring.map(coord => {
                                const [lng, lat] = proj4('EPSG:31983', 'EPSG:4326', coord);
                                return [lng, lat];
                            })
                        );
                    }
                });

                console.log('Reprojection complete!');
            }
        }

        const layer = L.geoJSON(geojsonData, {
            style: feature => getFeatureStyle(feature, config.color),
            pointToLayer: (feature, latlng) => {
                // For point geometries (like residencias), create circle markers
                return L.circleMarker(latlng, {
                    radius: 6,
                    fillColor: config.color,
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.7
                });
            },
            onEachFeature: (feature, layer) => {
                layer.on({
                    mouseover: highlightFeatureFixed,
                    mouseout: resetHighlight,
                    click: showFeatureInfo
                });

                // Add permanent label for distritos (formerly bairros)
                if (layerName === 'distritos' && feature.properties.NM_DIST) {
                    const label = feature.properties.NM_DIST;
                    layer.bindTooltip(label, {
                        permanent: true,
                        direction: 'center',
                        className: 'neighborhood-label'
                    });
                }
            }
        });

        dataLayers[layerName] = layer;

        // Apply black borders to distritos layer
        if (layerName === 'distritos') {
            layer.eachLayer(feature => {
                feature.setStyle({
                    color: '#000000',  // Black borders
                    weight: 2
                });
            });
        }

        // Add to map if checkbox is checked
        const checkbox = document.getElementById(`layer-${layerName}`);
        if (checkbox && checkbox.checked) {
            layer.addTo(map);
            console.log(`Layer ${layerName} added to map`);
        }

        return layer;
    } catch (error) {
        console.error(`Error loading layer ${layerName}:`, error);
        alert(`Erro ao carregar camada ${layerName}: ${error.message}\n\nVerifique se o arquivo ${CONFIG.layers[layerName].file} existe.`);
        throw error;
    }
}

function getFeatureStyle(feature, color) {
    return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: color,
        dashArray: '',
        fillOpacity: 0.3
    };
}

function highlightFeatureFixed(e) {
    const layer = e.target;
    const currentFillColor = layer.options.fillColor;
    const currentFillOpacity = layer.options.fillOpacity;

    if (layer instanceof L.CircleMarker) {
        layer.setStyle({
            radius: 8,
            weight: 3,
            color: '#ffffff',
            fillOpacity: currentFillOpacity,
            fillColor: currentFillColor
        });
    } else {
        const style = {
            weight: 3,
            color: '#ffffff',
            dashArray: '',
            fillOpacity: currentFillOpacity // Mantém a opacidade original
        };

        layer.setStyle(style);
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    const layer = e.target;
    const layerName = getLayerName(layer);

    // Check if it's a circle marker (point)
    const isCircleMarker = layer instanceof L.CircleMarker;

    // If thematic mapping is active, restore thematic color
    if (currentThematicAttribute && layerName === 'setores') {
        const value = layer.feature.properties[currentThematicAttribute];
        const color = getColorForValue(value, thematicBreaks, thematicColors);

        layer.setStyle({
            fillColor: color,
            weight: 1,
            opacity: 1,
            color: '#000000',
            fillOpacity: 0.7
        });
    } else {
        // Otherwise, restore original style
        const config = CONFIG.layers[layerName];
        if (config) {
            if (isCircleMarker) {
                layer.setStyle({
                    radius: 6,
                    fillColor: config.color,
                    color: '#ffffff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.7
                });
            } else {
                layer.setStyle(getFeatureStyle(layer.feature, config.color));
                if (layerName === 'distritos') {
                    layer.setStyle({
                        color: '#000000',  // Restore black border
                        weight: 2
                    });
                }
            }
        }
    }
}

function getLayerName(layer) {
    for (const [name, dataLayer] of Object.entries(dataLayers)) {
        if (dataLayer.hasLayer(layer)) {
            return name;
        }
    }
    return null;
}

function showFeatureInfo(e) {
    const feature = e.target.feature;
    const props = feature.properties;
    const layerName = getLayerName(e.target);

    // If it's a census sector, also populate the attribute table
    if (layerName === 'setores') {
        populateAttributeTable(props);
    }

    let content = '<div class="popup-content">';

    // Title
    if (layerName === 'distritos' && props.NM_DIST) {
        content += `<h3>${props.NM_DIST}</h3>`;
    } else if (props.NM_DIST) {
        content += `<h3>${props.NM_DIST}</h3>`;
    } else if (props.NM_BAIRRO && props.NM_BAIRRO !== '.' && props.NM_BAIRRO !== null) {
        content += `<h3>${props.NM_BAIRRO}</h3>`;
    } else if (props.CD_SETOR) {
        content += `<h3>Setor ${props.CD_SETOR}</h3>`;
    } else {
        content += `<h3>Informações</h3>`;
    }

    // Define all possible properties with labels
    const allProps = {
        'CD_SETOR': 'Código do Setor',
        'NM_MUN': 'Município',
        'NM_DIST': 'Distrito',
        'NM_BAIRRO': 'Bairro',
        'AREA_KM2': 'Área (km²)',
        'v0001': 'População Total',
        'v0002': 'Domicílios Particulares',
        'v0003': 'Domicílios Ocupados',
        'v0004': 'Domicílios Vagos',
        'v0005': 'Moradores por Domicílio',
        'v0006': 'Área Média (km²)',
        'v0007': 'Número de Residências',
        'NÚMERO DE RESIDÊNCIAS POR SETOR': 'Número de Residências',
        'RENDIMENTO NOMINAL MÉDIO POR SETOR': 'Renda Média (R$)'
    };

    // For census sectors, use selected attributes; for others, show all relevant data
    const propsToShow = (layerName === 'setores') ?
        Object.fromEntries(Object.entries(allProps).filter(([key]) => selectedAttributes.has(key))) :
        allProps;

    for (const [key, label] of Object.entries(propsToShow)) {
        if (props[key] !== undefined && props[key] !== null && props[key] !== '') {
            let value = props[key];

            // Format numbers
            if (key === 'AREA_KM2' || key === 'v0006') {
                value = parseFloat(value).toFixed(4);
            } else if (key === 'v0005') {
                value = parseFloat(value).toFixed(1);
            } else if (!isNaN(value) && value !== '') {
                const numValue = parseFloat(value);
                if (Number.isInteger(numValue)) {
                    value = parseInt(value).toLocaleString('pt-BR');
                } else {
                    value = numValue.toLocaleString('pt-BR');
                }
            }

            content += `<p><strong>${label}:</strong> ${value}</p>`;
        }
    }

    content += '</div>';

    L.popup()
        .setLatLng(e.latlng)
        .setContent(content)
        .openOn(map);
}

// ==================== Attribute Table Functions ====================
function populateAttributeTable(properties) {
    const tableBody = document.getElementById('attributeTableBody');
    const tablePanel = document.getElementById('attributeTablePanel');

    // Show the table panel
    tablePanel.style.display = 'block';

    // Clear existing rows
    tableBody.innerHTML = '';

    // Define all attributes with friendly names
    const attributeLabels = {
        'CD_SETOR': 'Código do Setor',
        'CD_REGIAO': 'Código da Região',
        'NM_REGIAO': 'Nome da Região',
        'CD_UF': 'Código da UF',
        'NM_UF': 'Nome da UF',
        'CD_MUN': 'Código do Município',
        'NM_MUN': 'Nome do Município',
        'CD_DIST': 'Código do Distrito',
        'NM_DIST': 'Nome do Distrito',
        'CD_SUBDIST': 'Código do Subdistrito',
        'NM_SUBDIST': 'Nome do Subdistrito',
        'CD_BAIRRO': 'Código do Bairro',
        'NM_BAIRRO': 'Nome do Bairro',
        'CD_RGINT': 'Código da Região Intermediária',
        'NM_RGINT': 'Nome da Região Intermediária',
        'CD_RGI': 'Código da Região Imediata',
        'NM_RGI': 'Nome da Região Imediata',
        'CD_CONCURB': 'Código da Concentração Urbana',
        'NM_CONCURB': 'Nome da Concentração Urbana',
        'AREA_KM2': 'Área (km²)',
        'v0001': 'População Total',
        'v0002': 'Domicílios Particulares Permanentes',
        'v0003': 'Domicílios Particulares Ocupados',
        'v0004': 'Domicílios Particulares Vagos',
        'v0005': 'Moradores por Domicílio',
        'v0006': 'Área Média por Domicílio (km²)',
        'v0007': 'Número de Residências',
        'NÚMERO DE RESIDÊNCIAS POR SETOR': 'Número de Residências',
        'RENDIMENTO NOMINAL MÉDIO POR SETOR': 'Renda Média (R$)',
        'Utiliza rede geral de distribuição': 'Água: Rede Geral',
        'Utiliza poço profundo ou artesiano': 'Água: Poço Artesiano',
        'Utiliza poço raso, freático ou cacimba': 'Água: Poço Raso',
        'Utiliza fonte, nascente ou mina': 'Água: Nascente',
        'Rede geral ou pluvial': 'Esgoto: Rede Geral',
        'fossa séptica ou fossa filtro ligada à rede': 'Esgoto: Fossa Séptica (ligada)',
        'fossa séptica ou fossa filtro não ligada à rede': 'Esgoto: Fossa Séptica (não ligada)',
        'fossa rudimentar ou buraco': 'Esgoto: Fossa Rudimentar',
        'vala': 'Esgoto: Vala',
        'rio, lago, córrego ou mar': 'Esgoto: Rio/Lago',
        'Lixo coletado no domicílio por serviço de limpeza': 'Lixo: Coletado',
        'Lixo queimado na propriedade': 'Lixo: Queimado',
        'Lixo enterrado na propriedade': 'Lixo: Enterrado'
    };

    // Populate table with all properties
    for (const [key, value] of Object.entries(properties)) {
        if (key === 'geometry') continue; // Skip geometry

        const row = document.createElement('tr');
        const labelCell = document.createElement('td');
        const valueCell = document.createElement('td');

        // Use friendly label or key itself
        labelCell.textContent = attributeLabels[key] || key;

        // Format value
        let formattedValue = value;
        if (value === null || value === undefined || value === '') {
            formattedValue = '-';
        } else if (key === 'AREA_KM2' || key === 'v0006') {
            formattedValue = parseFloat(value).toFixed(4);
        } else if (key === 'v0005') {
            formattedValue = parseFloat(value).toFixed(1);
        } else if (!isNaN(value) && typeof value === 'number') {
            formattedValue = value.toLocaleString('pt-BR');
        }

        valueCell.textContent = formattedValue;

        row.appendChild(labelCell);
        row.appendChild(valueCell);
        tableBody.appendChild(row);
    }

    // Scroll to top of table
    document.getElementById('attributeTableContainer').scrollTop = 0;
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    // Basemap selection
    document.querySelectorAll('.basemap-option').forEach(option => {
        option.addEventListener('click', () => {
            const basemap = option.dataset.basemap;
            addBasemap(basemap);
        });
    });

    // Layer toggles
    document.querySelectorAll('.layer-item input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', async (e) => {
            const layerName = e.target.id.replace('layer-', '');

            if (e.target.checked) {
                showLoading();
                await loadLayer(layerName);
                if (dataLayers[layerName]) {
                    dataLayers[layerName].addTo(map);
                }
                hideLoading();

                // Show attribute selector for census sectors
                if (layerName === 'setores') {
                    document.getElementById('attributeSelector').style.display = 'block';
                    // Show thematic mapping panel
                    document.getElementById('thematicMappingPanel').style.display = 'block';
                }
            } else {
                if (dataLayers[layerName]) {
                    map.removeLayer(dataLayers[layerName]);
                }

                // Hide attribute selector when census sectors is unchecked
                if (layerName === 'setores') {
                    document.getElementById('attributeSelector').style.display = 'none';
                    // Hide thematic mapping panel
                    document.getElementById('thematicMappingPanel').style.display = 'none';
                    // Reset thematic mapping if active
                    resetThematicMapping();
                }
            }
        });
    });

    // Attribute selector checkboxes
    document.querySelectorAll('#attributesList input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const attribute = e.target.value;

            if (e.target.checked) {
                selectedAttributes.add(attribute);
            } else {
                selectedAttributes.delete(attribute);
            }

            console.log('Atributos selecionados:', Array.from(selectedAttributes));
        });
    });

    // Map controls
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        map.zoomIn();
    });

    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        map.zoomOut();
    });

    document.getElementById('homeBtn').addEventListener('click', () => {
        map.setView(CONFIG.center, CONFIG.zoom);
    });

    // Info modal
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.getElementById('closeModal');

    infoBtn.addEventListener('click', () => {
        infoModal.classList.add('active');
    });

    closeModal.addEventListener('click', () => {
        infoModal.classList.remove('active');
    });

    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) {
            infoModal.classList.remove('active');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            infoModal.classList.remove('active');
            // Also close attribute table if open
            const tablePanel = document.getElementById('attributeTablePanel');
            if (tablePanel.style.display === 'block') {
                tablePanel.style.display = 'none';
            }
        }
    });

    // Close table button
    document.getElementById('closeTableBtn').addEventListener('click', () => {
        document.getElementById('attributeTablePanel').style.display = 'none';
    });

    // Thematic Mapping Buttons
    const attributeSelect = document.getElementById('thematicAttributeSelect');
    const applyBtn = document.getElementById('applyThematicBtn');
    const resetBtn = document.getElementById('resetThematicBtn');

    attributeSelect.addEventListener('change', () => {
        applyBtn.disabled = !attributeSelect.value;
    });

    applyBtn.addEventListener('click', () => {
        const attribute = attributeSelect.value;
        if (attribute) {
            applyThematicMapping(attribute);
            resetBtn.style.display = 'flex';
        }
    });

    resetBtn.addEventListener('click', () => {
        resetThematicMapping();
        attributeSelect.value = '';
        applyBtn.disabled = true;
        resetBtn.style.display = 'none';
    });
}

function showLoading() {
    loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
    }
}

function hideLoading() {
    loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
    }
}

// ==================== Thematic Mapping Functions ====================
let currentThematicAttribute = null;
let thematicBreaks = [];
let thematicColors = [];

function applyThematicMapping(attribute) {
    if (!dataLayers['setores']) return;

    showLoading();
    currentThematicAttribute = attribute;

    // 1. Extract values
    const values = [];
    dataLayers['setores'].eachLayer(layer => {
        const val = parseFloat(layer.feature.properties[attribute]);
        if (!isNaN(val)) {
            values.push(val);
        }
    });

    if (values.length === 0) {
        alert('Não há dados numéricos válidos para este atributo.');
        hideLoading();
        return;
    }

    // 2. Calculate Jenks Natural Breaks (simplified to quantiles or equal intervals for now)
    // Using 5 classes
    values.sort((a, b) => a - b);
    thematicBreaks = calculateJenks(values, 5);
    
    // 3. Define colors (ColorBrewer YlOrRd)
    thematicColors = [
        '#ffffb2',
        '#fecc5c',
        '#fd8d3c',
        '#f03b20',
        '#bd0026'
    ];

    // 4. Apply style
    dataLayers['setores'].eachLayer(layer => {
        const val = parseFloat(layer.feature.properties[attribute]);
        const color = getColorForValue(val, thematicBreaks, thematicColors);
        
        layer.setStyle({
            fillColor: color,
            fillOpacity: 0.8,
            weight: 1,
            color: '#333'
        });
    });

    // 5. Update Legend
    updateLegend(attribute, thematicBreaks, thematicColors);

    hideLoading();
}

function resetThematicMapping() {
    if (!dataLayers['setores']) return;
    
    currentThematicAttribute = null;
    const config = CONFIG.layers['setores'];
    
    dataLayers['setores'].eachLayer(layer => {
        layer.setStyle(getFeatureStyle(layer.feature, config.color));
    });

    document.getElementById('legendContainer').style.display = 'none';
}

function getColorForValue(value, breaks, colors) {
    if (value === undefined || value === null || isNaN(value)) return '#ccc';
    
    for (let i = 0; i < breaks.length; i++) {
        if (value <= breaks[i]) {
            return colors[i];
        }
    }
    return colors[colors.length - 1];
}

// Simple implementation of Jenks/Quantiles (using Quantiles for robustness)
function calculateJenks(values, classes) {
    const breaks = [];
    const step = Math.floor(values.length / classes);
    
    for (let i = 1; i < classes; i++) {
        breaks.push(values[i * step]);
    }
    breaks.push(values[values.length - 1]);
    
    return breaks;
}

function updateLegend(attribute, breaks, colors) {
    const container = document.getElementById('legendContainer');
    const content = document.getElementById('legendContent');
    const title = container.querySelector('.legend-title');
    
    title.textContent = `Legenda: ${attribute}`;
    content.innerHTML = '';
    
    let start = 0;
    for (let i = 0; i < breaks.length; i++) {
        const end = breaks[i];
        const color = colors[i];
        
        // Format numbers
        const startFmt = start.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        const endFmt = end.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
        
        const item = document.createElement('div');
        item.className = 'legend-class-item';
        item.innerHTML = `
            <div class="legend-color-box" style="background: ${color}"></div>
            <span class="legend-label">${startFmt} - ${endFmt}</span>
        `;
        
        content.appendChild(item);
        start = end;
    }
    
    container.style.display = 'block';
}

// Initialize map when DOM is ready
document.addEventListener('DOMContentLoaded', initMap);