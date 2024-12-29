let mediaRecorder;
let audioChunks = [];
let audioStream;
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

            mediaRecorder.onstop = () => sendAudioToServer();

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

async function sendAudioToServer(formData) {
    try {
        // 如果是录音数据，需要先转换为WAV格式
        if (!formData) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioData = await audioBlob.arrayBuffer();
            const wavBlob = await convertToWav(audioData);
            formData = new FormData();
            formData.append('audio', wavBlob, 'audio.wav');
        }

        const response = await fetch('/transcribe', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            updateStatus('error', '错误: ' + data.error);
        } else {
            updateStatus('ready', '转写完成');
            // 显示下载部分
            document.getElementById('downloadSection').style.display = 'block';
            // 显示预览部分并加载转写内容
            try {
                const response = await fetch(`/recordings/${data.generatedFiles[0]}`);
                const text = await response.text();
                document.getElementById('previewText').textContent = text;
                document.getElementById('previewSection').style.display = 'block';
            } catch (err) {
                updateStatus('error', '无法加载转写内容: ' + err.message);
            }

            // 设置下载选中文件功能
            document.getElementById('downloadSelected').onclick = async () => {
                const selectedFiles = [];
                document.querySelectorAll('.file-checkbox:checked').forEach(checkbox => {
                    const fileType = checkbox.dataset.file;
                    if (fileType === 'audio') {
                        selectedFiles.push(data.audioFilename);
                    } else {
                        selectedFiles.push(`${data.audioFilename.split('.')[0]}.${fileType}`);
                    }
                });

                if (selectedFiles.length === 0) {
                    alert('请至少选择一个文件');
                    return;
                }

                try {
                    const response = await fetch('/download', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ files: selectedFiles })
                    });

                    if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `transcripts_${new Date().toISOString()}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                    } else {
                        const errorData = await response.json();
                        throw new Error(errorData.error || '下载失败');
                    }
                } catch (err) {
                    updateStatus('error', '下载错误: ' + err.message);
                }
            };
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

// 文件上传功能
const uploadButton = document.getElementById('uploadButton');
const audioFileInput = document.getElementById('audioFile');
uploadButton.addEventListener('click', handleFileUpload);

function handleFileUpload() {
    const file = audioFileInput.files[0];

    // 验证文件
    if (!file) {
        alert('请选择一个音频文件');
        return;
    }

    // 验证文件类型
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/aac'];
    if (!allowedTypes.includes(file.type)) {
        alert('不支持的文件类型');
        return;
    }

    // 验证文件大小 (限制为100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
        alert('文件大小不能超过100MB');
        return;
    }

    // 更新状态
    updateStatus('processing', '处理中...');

    // 创建FormData并发送
    const formData = new FormData();
    formData.append('audio', file, file.name);

    sendAudioToServer(formData);
}


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

// 添加折叠/展开功能
document.getElementById('togglePreview').addEventListener('click', () => {
    const previewSection = document.getElementById('previewSection');
    previewSection.classList.toggle('collapsed');
});

// 页面加载时设置初始状态
document.addEventListener('DOMContentLoaded', () => {
    updateStatus('ready', '准备就绪');
    // 默认展开预览区域
    document.getElementById('previewSection').classList.remove('collapsed');
});
