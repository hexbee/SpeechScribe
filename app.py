from flask import Flask, render_template, request, jsonify, send_file
import whisper
import torch
from whisper.utils import get_writer
import os
import zipfile
from datetime import datetime

app = Flask(__name__)
MODEL_NAME = "turbo"
model = whisper.load_model(MODEL_NAME)
UPLOAD_FOLDER = 'recordings'

# 确保上传文件夹存在
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)


@app.route('/')
def index():
    cuda_available = torch.cuda.is_available()
    return render_template(
        'index.html', cuda_available=cuda_available, model_name=MODEL_NAME)


@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': '没有收到音频文件'}), 400

    audio_file = request.files['audio']

    if audio_file.filename == '':
        return jsonify({'error': '未选择文件'}), 400

    # 文件类型验证
    allowed_types = [
        'audio/wav',
        'audio/mpeg',
        'audio/ogg',
        'audio/flac',
        'audio/aac']
    if audio_file.mimetype not in allowed_types:
        return jsonify({'error': '不支持的文件类型'}), 400

    # 文件大小验证 (100MB)
    max_size = 100 * 1024 * 1024
    audio_file.seek(0, os.SEEK_END)
    file_size = audio_file.tell()
    audio_file.seek(0)
    if file_size > max_size:
        return jsonify({'error': '文件大小不能超过100MB'}), 400

    # 生成唯一的文件名
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    saved_filename = f"recording_{timestamp}.wav"
    saved_path = os.path.join(UPLOAD_FOLDER, saved_filename)

    audio_file.save(saved_path)

    try:
        # 使用 Whisper 进行转写
        result = model.transcribe(saved_path)

        # 生成所有格式的转录文件
        formats = ['txt', 'vtt', 'srt', 'tsv', 'json']
        generated_files = []

        for format in formats:
            writer = get_writer(format, UPLOAD_FOLDER)
            output_path = os.path.join(
                UPLOAD_FOLDER, f"{saved_filename.split('.')[0]}.{format}")
            writer(result, saved_path)
            generated_files.append(f"{saved_filename.split('.')[0]}.{format}")

        response_data = {
            'audioFilename': saved_filename,
            'generatedFiles': generated_files
        }

        return jsonify(response_data)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/recordings/<filename>')
def get_recording(filename):
    try:
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(file_path):
            return jsonify({'error': '文件不存在'}), 404

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        return content, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/download', methods=['POST'])
def download_files():
    try:
        files = request.json.get('files', [])
        if not files:
            return jsonify({'error': '未选择文件'}), 400

        # 创建临时zip文件
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        zip_filename = f"transcripts_{timestamp}.zip"
        zip_path = os.path.join(UPLOAD_FOLDER, zip_filename)

        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for file in files:
                file_path = os.path.join(UPLOAD_FOLDER, file)
                if os.path.exists(file_path):
                    zipf.write(file_path, arcname=file)

        # 发送zip文件
        response = send_file(
            zip_path,
            as_attachment=True,
            download_name=zip_filename
        )

        # 删除临时zip文件
        os.remove(zip_path)

        return response

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
