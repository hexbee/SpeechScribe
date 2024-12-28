from flask import Flask, render_template, request, jsonify, send_file
import whisper
import os
from datetime import datetime

app = Flask(__name__)
model = whisper.load_model("turbo")
UPLOAD_FOLDER = 'recordings'

# 确保上传文件夹存在
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'audio' not in request.files:
        return jsonify({'error': '没有收到音频文件'}), 400
    
    audio_file = request.files['audio']
    save_audio = request.form.get('saveAudio') == 'true'
    
    if audio_file.filename == '':
        return jsonify({'error': '未选择文件'}), 400

    # 生成唯一的文件名
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    temp_path = "temp_audio.wav"
    
    if save_audio:
        saved_filename = f"recording_{timestamp}.wav"
        saved_path = os.path.join(UPLOAD_FOLDER, saved_filename)
    
    audio_file.save(temp_path)
    
    try:
        # 使用 Whisper 进行转写
        result = model.transcribe(temp_path)
        
        # 如果需要保存文件，复制到永久存储位置
        if save_audio:
            os.rename(temp_path, saved_path)
        else:
            os.remove(temp_path)
            
        response_data = {
            'transcription': result["text"],
            'segments': [{
                'start': format_time(segment['start']),
                'end': format_time(segment['end']),
                'text': segment['text']
            } for segment in result["segments"]]
        }
        
        if save_audio:
            response_data['audioFilename'] = saved_filename
            
        return jsonify(response_data)
        
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    try:
        return send_file(
            os.path.join(UPLOAD_FOLDER, filename),
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({'error': '文件不存在'}), 404

def format_time(seconds):
    """将秒数转换为 HH:MM:SS.mmm 格式"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    seconds = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:06.3f}"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
