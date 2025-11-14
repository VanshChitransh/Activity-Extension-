let events = [];

chrome.storage.local.get(['events'], (data) => {
    events = data.events || [];
    renderEvents();
    updateEventCount();
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'exportPDF') {
        generatePDF();
    }
});

document.getElementById('exportBtn').addEventListener('click', () => generatePDF());

document.getElementById('exportJsonBtn').addEventListener('click', () => {
    const data = {
        exportDate: new Date().toISOString(),
        totalEvents: events.length,
        events: events
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('Clear all recorded events?')) {
        await chrome.storage.local.set({ events: [] });
        events = [];
        renderEvents();
        updateEventCount();
    }
});

document.getElementById('imageModal').addEventListener('click', (e) => {
    if (e.target.id === 'imageModal' || e.target.tagName === 'IMG') {
        document.getElementById('imageModal').classList.remove('active');
    }
});

function renderEvents() {
    const feed = document.getElementById('chat-feed');
    feed.innerHTML = '';

    if (events.length === 0) {
        feed.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No events recorded yet</div>
                <p class="text-muted mt-2">Start recording to capture interactions</p>
            </div>
        `;
        return;
    }

    events.forEach(event => renderEvent(event));
}

function renderEvent(event) {
    const feed = document.getElementById('chat-feed');
    const eventDiv = document.createElement('div');
    eventDiv.className = 'event-item';

    const timestamp = new Date(event.timestamp).toLocaleTimeString();

    let html = `
        <div class="event-timestamp">${timestamp}</div>
        <div class="event-content">
            <span class="event-type ${event.type}">${event.type.replace(/_/g, ' ')}</span>
            <div class="event-details">${escapeHtml(event.description)}</div>
    `;

    if (event.typedText) {
        html += `
            <div class="event-details mt-1">
                <strong>Typed:</strong> ${escapeHtml(event.typedText)}
            </div>
        `;
    }

    if (event.coordinates) {
        html += `
            <div class="event-details" style="font-size: 11px; color: #a0a0a0; margin-top: 4px;">
                Position: (${event.coordinates.x}, ${event.coordinates.y})
            </div>
        `;
    }

    html += `</div>`;

    if (event.screenshot) {
        html += `
            <div class="event-screenshot">
                <img src="${event.screenshot}" alt="Screenshot">
            </div>
        `;
    }

    eventDiv.innerHTML = html;

    if (event.screenshot) {
        const img = eventDiv.querySelector('.event-screenshot img');
        if (img) {
            img.addEventListener('click', () => showFullImage(event.screenshot));
        }
    }

    feed.appendChild(eventDiv);
}

function showFullImage(src) {
    document.getElementById('modalImage').src = src;
    document.getElementById('imageModal').classList.add('active');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateEventCount() {
    document.getElementById('eventCount').textContent = `${events.length} events`;
}

async function generatePDF() {
    if (events.length === 0) {
        alert('No events to export!');
        return;
    }

    console.log('Starting PDF generation with', events.length, 'events');

    try {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            throw new Error('jsPDF library not loaded. Please reload the page.');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        let yPos = 20;
        const pageHeight = doc.internal.pageSize.height;
        const pageWidth = doc.internal.pageSize.width;
        const margin = 20;
        const maxWidth = pageWidth - (margin * 2);

        doc.setFontSize(20);
        doc.text('Screen Recording Session Report', margin, yPos);
        yPos += 10;

        doc.setFontSize(12);
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, yPos);
        yPos += 7;
        doc.text(`Total Events: ${events.length}`, margin, yPos);
        yPos += 7;
        doc.text(`Session URL: ${events[0]?.url || 'N/A'}`, margin, yPos);
        yPos += 15;

        doc.setFontSize(16);
        doc.text('Events', margin, yPos);
        yPos += 10;

        for (let i = 0; i < events.length; i++) {
            const event = events[i];

            if (yPos > pageHeight - 40) {
                doc.addPage();
                yPos = 20;
            }

            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`${i + 1}. ${event.type.toUpperCase()}`, margin, yPos);
            yPos += 7;

            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.text(`Time: ${new Date(event.timestamp).toLocaleString()}`, margin, yPos);
            yPos += 6;

            const descLines = doc.splitTextToSize(event.description, maxWidth);
            doc.text(descLines, margin, yPos);
            yPos += (descLines.length * 5) + 2;

            if (event.typedText) {
                doc.setFont(undefined, 'italic');
                const typedLines = doc.splitTextToSize(`Typed: ${event.typedText}`, maxWidth);
                doc.text(typedLines, margin, yPos);
                yPos += (typedLines.length * 5) + 2;
                doc.setFont(undefined, 'normal');
            }

            if (event.screenshot) {
                if (yPos > pageHeight - 100) {
                    doc.addPage();
                    yPos = 20;
                }

                try {
                    const imgWidth = maxWidth;
                    const imgHeight = 80;
                    doc.addImage(event.screenshot, 'JPEG', margin, yPos, imgWidth, imgHeight);
                    yPos += imgHeight + 10;
                } catch (e) {
                    console.error('Failed to add image:', e);
                    doc.text('(Screenshot could not be embedded)', margin, yPos);
                    yPos += 7;
                }
            }

            yPos += 5;
        }

        const filename = `session-report-${Date.now()}.pdf`;
        doc.save(filename);
        console.log('PDF saved successfully:', filename);
        alert(`✅ PDF exported as ${filename}`);
    } catch (error) {
        console.error('PDF generation error:', error);
        alert(`❌ Failed to generate PDF: ${error.message}`);
    }
}
