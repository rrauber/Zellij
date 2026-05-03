const fs = require('fs');

let code = fs.readFileSync('src/components/ZellijApp.jsx', 'utf8');

code = code.replace(/\/\/ ============================ SMALL RENDER COMPONENTS ============================\s*([\s\S]*?)$/, '');

fs.writeFileSync('src/components/ZellijApp.jsx', code);
