let mediaRecorder;
let audioChunks = [];
let audioStream;
let currentPage = 1;
let pageSize = 10;
let allSegments = [];
let timerInterval;
let startTime;
let isRecording = false;
const recordButton = document.getElementById('recordButton');

recordButton.addEventListener('click', toggleRecording);

async function toggleRecording() {
    if (!isRecording) {
        // 开始录音
        try {
            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
            }
            
            audioChunks = [];
            
            // 清空之前的转写结果
            document.getElementById('transcription').textContent = '';
            document.getElementById('segments').innerHTML = '';
            document.getElementById('downloadSection').style.display = 'none';
            
            // 获取用户设置的参数
            const sampleRate = parseInt(document.getElementById('sampleRate').value);
            const audioBitsPerSecond = parseInt(document.getElementById('audioBitsPerSecond').value);
            
            audioStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    channelCount: 1,
                    sampleRate: sampleRate,
                    sampleSize: 16,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            mediaRecorder = new MediaRecorder(audioStream, {
                mimeType: 'audio/webm',
                audioBitsPerSecond: audioBitsPerSecond
            });
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = sendAudioToServer;
            
            mediaRecorder.start();
            updateStatus('recording', '');
            startTimer();
            
            // 更新按钮状态
            recordButton.classList.add('recording');
            recordButton.innerHTML = '<i class="fas fa-stop"></i><span>停止录音</span>';
            isRecording = true;
            
        } catch (err) {
            console.error('录音失败:', err);
            updateStatus('error', '录音失败: ' + err.message);
        }
    } else {
        // 停止录音
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
            }
        }
        stopTimer();
        updateStatus('processing', '处理中...');
        
        // 更新按钮状态
        recordButton.classList.remove('recording');
        recordButton.innerHTML = '<i class="fas fa-microphone"></i><span>开始录音</span>';
        isRecording = false;
    }
}

async function sendAudioToServer() {
    // 将音频数据转换为标准 WAV 格式
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const audioData = await audioBlob.arrayBuffer();
    
    // 创建 WAV 格式的音频数据
    const wavBlob = await convertToWav(audioData);
    
    const formData = new FormData();
    formData.append('audio', wavBlob, 'audio.wav');
    formData.append('saveAudio', document.getElementById('saveAudio').checked);

    try {
        const response = await fetch('/transcribe', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.error) {
            updateStatus('error', '错误: ' + data.error);
        } else {
            updateStatus('ready', '转写完成');
            document.getElementById('transcription').textContent = data.transcription;
            
            // 保存所有片段并显示第一页
            allSegments = data.segments;
            showPage(1);
            
            // 如果保存了音频文件，显示下载按钮
            if (data.audioFilename) {
                document.getElementById('downloadSection').style.display = 'block';
                const downloadBtn = document.getElementById('downloadAudio');
                downloadBtn.onclick = () => {
                    window.location.href = `/download/${data.audioFilename}`;
                };
            } else {
                document.getElementById('downloadSection').style.display = 'none';
            }
        }
    } catch (err) {
        updateStatus('error', '上传失败: ' + err.message);
    } finally {
        // 清理资源
        audioChunks = [];
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
    }
}

// 添加转换 WAV 格式的函数
async function convertToWav(audioData) {
    // 创建音频上下文
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // 解码音频数据
    const audioBuffer = await audioContext.decodeAudioData(audioData);
    
    // 获取音频参数
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    
    // 创建 WAV 文件头
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    
    // WAV 文件头
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true);
    view.setUint16(32, numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, length * 2, true);
    
    // 写入音频数据
    const data = new Float32Array(audioBuffer.getChannelData(0));
    let offset = 44;
    for (let i = 0; i < data.length; i++) {
        const sample = Math.max(-1, Math.min(1, data[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

window.addEventListener('beforeunload', () => {
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
});

// 添加分页显示函数
function showPage(page) {
    const segmentsDiv = document.getElementById('segments');
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedSegments = allSegments.slice(start, end);
    
    // 添加淡出效果
    const oldSegments = segmentsDiv.children;
    Array.from(oldSegments).forEach(segment => {
        segment.classList.add('fade-out');
    });
    
    setTimeout(() => {
        // 更新内容
        segmentsDiv.innerHTML = paginatedSegments.map(segment => `
            <div class="segment fade-in">
                <span class="time">${segment.start} --> ${segment.end}</span>
                <span class="text">${segment.text}</span>
            </div>
        `).join('');
        
        // 恢复保存的字体大小设置
        const savedSize = localStorage.getItem('fontSize_segments');
        if (savedSize) {
            const textElements = segmentsDiv.querySelectorAll('.text');
            textElements.forEach(el => el.style.fontSize = `${savedSize}px`);
        }
        
        // 更新分页控件
        updatePagination(page);
    }, 300);
}

// 添加分页控件更新函数
function updatePagination(currentPage) {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(allSegments.length / pageSize);
    
    let paginationHTML = '';
    
    // 上一页按钮
    paginationHTML += `
        <button class="page-button" ${currentPage === 1 ? 'disabled' : ''} 
                onclick="showPage(${currentPage - 1})">
            <i class="fas fa-chevron-left"></i>
        </button>
    `;
    
    // 页码按钮
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            paginationHTML += `
                <button class="page-button ${i === currentPage ? 'active' : ''}" 
                        onclick="showPage(${i})">
                    ${i}
                </button>
            `;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            paginationHTML += '<span class="page-button">...</span>';
        }
    }
    
    // 下一页按钮
    paginationHTML += `
        <button class="page-button" ${currentPage === totalPages ? 'disabled' : ''} 
                onclick="showPage(${currentPage + 1})">
            <i class="fas fa-chevron-right"></i>
        </button>
    `;
    
    pagination.innerHTML = paginationHTML;
}

// 添加页面大小变化监听
document.getElementById('pageSize').addEventListener('change', (e) => {
    pageSize = parseInt(e.target.value);
    showPage(1);
});

// 添加复制文本功能
document.getElementById('copyText').addEventListener('click', () => {
    const text = document.getElementById('transcription').textContent;
    navigator.clipboard.writeText(text).then(() => {
        alert('文本已复制到剪贴板');
    });
});

// 添加展开/收起功能
document.getElementById('expandText').addEventListener('click', () => {
    const wrapper = document.querySelector('.transcription-wrapper');
    wrapper.classList.toggle('expanded');
    const icon = document.querySelector('#expandText i');
    icon.classList.toggle('fa-expand-alt');
    icon.classList.toggle('fa-compress-alt');
});

// 添加状态管理函数
function updateStatus(status, message) {
    const statusElement = document.getElementById('status');
    const statusText = statusElement.querySelector('.status-text');
    
    // 移除所有状态类
    statusElement.classList.remove('ready', 'recording', 'processing', 'error');
    // 添加新状态类
    statusElement.classList.add(status);
    
    statusText.textContent = message;
}

// 添加计时器函数
function startTimer() {
    startTime = Date.now();
    const timerElement = document.getElementById('timer');
    
    timerInterval = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        const seconds = Math.floor(elapsedTime / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        const formattedTime = `${hours.toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
        timerElement.textContent = formattedTime;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    document.getElementById('timer').textContent = '';
}

// 页面加载时设置初始状态
document.addEventListener('DOMContentLoaded', () => {
    updateStatus('ready', '准备就绪');
    
    // 恢复字体大小设置
    ['transcription', 'segments'].forEach(id => {
        const savedSize = localStorage.getItem(`fontSize_${id}`);
        if (savedSize) {
            if (id === 'segments') {
                const textElements = document.getElementById(id).querySelectorAll('.text');
                textElements.forEach(el => el.style.fontSize = `${savedSize}px`);
            } else {
                document.getElementById(id).style.fontSize = `${savedSize}px`;
            }
        }
    });
});

// 添加字体大小控制函数
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 16;

function changeFontSize(elementId, delta) {
    const element = document.getElementById(elementId);
    const currentSize = parseInt(window.getComputedStyle(element).fontSize);
    const newSize = Math.min(Math.max(currentSize + delta, MIN_FONT_SIZE), MAX_FONT_SIZE);
    
    if (elementId === 'segments') {
        // 为所有段落文本设置字体大小
        const textElements = element.querySelectorAll('.text');
        textElements.forEach(el => el.style.fontSize = `${newSize}px`);
    } else {
        element.style.fontSize = `${newSize}px`;
    }
    
    // 保存字体大小设置到 localStorage
    localStorage.setItem(`fontSize_${elementId}`, newSize);
}

function resetFontSize(elementId) {
    if (elementId === 'segments') {
        const textElements = document.getElementById(elementId).querySelectorAll('.text');
        textElements.forEach(el => el.style.fontSize = `${DEFAULT_FONT_SIZE}px`);
    } else {
        document.getElementById(elementId).style.fontSize = `${DEFAULT_FONT_SIZE}px`;
    }
    
    // 清除保存的字体大小设置
    localStorage.removeItem(`fontSize_${elementId}`);
} 