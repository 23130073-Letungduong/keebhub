// Vẽ biểu đồ Chart.js từ thuộc tính data-* trên <canvas>
(function () {
  if (!window.Chart) return;
  var PALETTE = ['#1B62F5', '#FF5A1F', '#079455', '#7C3AED', '#DC6803', '#0E7490', '#BE185D', '#98A2B3'];
  Chart.defaults.font.family = "'Be Vietnam Pro', system-ui, sans-serif";
  // Màu chữ / lưới / viền theo chế độ sáng–tối
  function tc() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return { text: dark ? '#B4BCC9' : '#475467', grid: dark ? '#2A3141' : '#EFF1F5', edge: dark ? '#161B26' : '#fff' };
  }
  Chart.defaults.color = tc().text;
  window.khChartsTheme = function () {
    var c = tc();
    Chart.defaults.color = c.text;
    Object.values(Chart.instances || {}).forEach(function (ch) {
      if (ch.options.scales && ch.options.scales.y && ch.options.scales.y.grid) ch.options.scales.y.grid.color = c.grid;
      // Chỉ gán thuộc tính lá (không gán lại cả object vì options của Chart.js là proxy → đệ quy vô hạn)
      ['x', 'y', 'y2'].forEach(function (k) { var sc = ch.options.scales && ch.options.scales[k]; if (sc && sc.ticks) sc.ticks.color = c.text; });
      var lg = ch.options.plugins && ch.options.plugins.legend; if (lg && lg.labels) lg.labels.color = c.text;
      if (ch.config.type === 'pie' || ch.config.type === 'doughnut') ch.data.datasets.forEach(function (d) { d.borderColor = c.edge; });
      ch.update('none');
    });
  };
  function vnd(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' tỷ';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'tr';
    if (v >= 1e3) return Math.round(v / 1e3) + 'k';
    return v;
  }
  function full(v) { return Math.round(v).toLocaleString('vi-VN') + '₫'; }
  document.querySelectorAll('canvas[data-chart]').forEach(function (c) {
    var type = c.dataset.chart;
    var labels = JSON.parse(c.dataset.labels || '[]');
    var values = JSON.parse(c.dataset.values || '[]');
    var isMoney = c.dataset.money !== '0';
    if (type === 'bar') {
      var ds = [{ type: 'bar', label: c.dataset.label || 'Giá trị', data: values, backgroundColor: '#1B62F5', borderRadius: 6, maxBarThickness: 38, yAxisID: 'y', order: 2 }];
      var scales = { y: { beginAtZero: true, ticks: { callback: vnd }, grid: { color: tc().grid } }, x: { grid: { display: false } } };
      if (c.dataset.values2) {
        ds.push({ type: 'line', label: c.dataset.label2 || '', data: JSON.parse(c.dataset.values2), borderColor: '#FF5A1F', backgroundColor: '#FF5A1F', tension: .3, yAxisID: 'y2', order: 1, pointRadius: 3 });
        scales.y2 = { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { precision: 0 } };
      }
      new Chart(c, {
        data: { labels: labels, datasets: ds },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: !!c.dataset.values2, position: 'bottom' }, tooltip: { callbacks: { label: function (x) { return x.dataset.label + ': ' + (x.dataset.yAxisID === 'y' ? full(x.parsed.y) : x.parsed.y); } } } },
          scales: scales
        }
      });
    } else {
      var total = values.reduce(function (a, b) { return a + b; }, 0);
      new Chart(c, {
        type: type,
        data: { labels: labels, datasets: [{ data: values, backgroundColor: PALETTE, borderWidth: 2, borderColor: tc().edge }] },
        options: {
          maintainAspectRatio: false, cutout: type === 'doughnut' ? '62%' : 0,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } },
            tooltip: { callbacks: { label: function (x) { var pc = total ? Math.round(x.parsed / total * 100) : 0; return x.label + ': ' + (isMoney ? full(x.parsed) : x.parsed) + ' (' + pc + '%)'; } } }
          }
        }
      });
    }
  });
})();
