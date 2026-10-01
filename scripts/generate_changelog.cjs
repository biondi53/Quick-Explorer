const { execSync } = require('child_process');
const fs = require('fs');

function getChanges() {
    try {
        // Get the last two tags to find the range
        const tags = execSync('git tag --sort=-v:refname').toString().split('\n').filter(Boolean);
        let range = '';

        if (tags.length >= 2) {
            range = `${tags[1]}..${tags[0]}`;
        } else if (tags.length === 1) {
            // If only one tag, get all commits up to that tag
            range = tags[0];
        }

        const logCommand = range ? `git log ${range} --pretty=format:"%s"` : 'git log --pretty=format:"%s"';
        const commits = execSync(logCommand).toString().split('\n').filter(Boolean);

        const categories = {
            feat: [],
            fix: [],
            refactor: [],
            perf: [],
            chore: [],
            other: []
        };

        commits.forEach(msg => {
            const lower = msg.toLowerCase();
            if (lower.startsWith('feat')) categories.feat.push(msg);
            else if (lower.startsWith('fix')) categories.fix.push(msg);
            else if (lower.startsWith('refactor')) categories.refactor.push(msg);
            else if (lower.startsWith('perf')) categories.perf.push(msg);
            else if (lower.startsWith('chore')) categories.chore.push(msg);
            else categories.other.push(msg);
        });

        let changelog = `# 🚀 SpeedExplorer ${tags[0] || 'Release'}\n\n`;

        if (categories.feat.length) {
            changelog += `## ✨ Nuevas Funcionalidades\n${categories.feat.map(m => `- ${m}`).join('\n')}\n\n`;
        }
        if (categories.fix.length) {
            changelog += `## ⚙️ Correcciones\n${categories.fix.map(m => `- ${m}`).join('\n')}\n\n`;
        }
        if (categories.perf.length || categories.refactor.length) {
            changelog += `## ⚡ Optimizaciones\n${[...categories.perf, ...categories.refactor].map(m => `- ${m}`).join('\n')}\n\n`;
        }
        if (categories.other.length) {
            changelog += `## 📝 Otros Cambios\n${categories.other.map(m => `- ${m}`).join('\n')}\n\n`;
        }

        return changelog;
    } catch (error) {
        return "Novedades en esta versión de SpeedExplorer.";
    }
}

console.log(getChanges());
