/**
 * GeminiService.gs
 * Proxy gọi Gemini API (giấu GEMINI_API_KEY ở GAS Script Properties).
 */

/**
 * Gọi Gemini generateContent và ép kiểu JSON thuần.
 *
 * @param {Array<Object>} parts Mảng parts theo chuẩn Gemini API
 * @return {Object}
 */
function callGeminiJson_(parts) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = String(props.getProperty('GEMINI_API_KEY') || '').trim();
  if (!apiKey) {
    throw createAppError_('GEMINI_ERROR', 'Chưa cấu hình Script Property GEMINI_API_KEY.');
  }

  var model = String(props.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash').trim();
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

  var requestBody = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  var res;
  try {
    res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });
  } catch (err) {
    throw createAppError_('GEMINI_ERROR', 'Không thể kết nối Gemini API: ' + err.message);
  }

  var code = res.getResponseCode();
  var rawText = res.getContentText();
  if (code !== 200) {
    throw createAppError_('GEMINI_ERROR', 'Gemini API trả lỗi HTTP ' + code + ': ' + rawText.slice(0, 300));
  }

  var responseJson;
  try {
    responseJson = JSON.parse(rawText);
  } catch (e) {
    throw createAppError_('GEMINI_ERROR', 'Không parse được JSON phản hồi từ Gemini API.');
  }

  var candidateText = '';
  if (
    responseJson.candidates &&
    responseJson.candidates.length > 0 &&
    responseJson.candidates[0].content &&
    responseJson.candidates[0].content.parts &&
    responseJson.candidates[0].content.parts.length > 0
  ) {
    candidateText = String(responseJson.candidates[0].content.parts[0].text || '');
  }

  if (!candidateText) {
    throw createAppError_('GEMINI_ERROR', 'Gemini API không trả về nội dung văn bản.');
  }

  var cleaned = candidateText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (jsonErr) {
    throw createAppError_('GEMINI_ERROR', 'Kết quả Gemini không phải JSON hợp lệ: ' + cleaned.slice(0, 200));
  }
}

/**
 * Bóc tách tổng tiền và tóm tắt món từ ảnh hóa đơn (sân cầu lông hoặc ăn nhậu).
 *
 * @param {string} base64Image
 * @param {string=} mimeType
 * @return {{total_amount: number, items_summary: string, suggested_title: string}}
 */
function parseBillImage(base64Image, mimeType) {
  if (!base64Image || typeof base64Image !== 'string') {
    throw createAppError_('BAD_REQUEST', 'Thiếu ảnh hóa đơn base64 để phân tích.');
  }

  var cleanMime = String(mimeType || '').trim();
  var cleanBase64 = base64Image.trim();
  var dataUrlMatch = cleanBase64.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    if (!cleanMime) {
      cleanMime = dataUrlMatch[1];
    }
    cleanBase64 = dataUrlMatch[2];
  }
  if (!cleanMime) {
    cleanMime = 'image/jpeg';
  }

  var prompt = [
    'Bạn là trợ lý kế toán cho câu lạc bộ cầu lông và ăn nhậu tại Việt Nam.',
    'Hãy đọc ảnh hóa đơn này và trích xuất thông tin chính xác bằng tiếng Việt.',
    'Quy tắc:',
    '1. "total_amount": Tổng số tiền thanh toán cuối cùng tính bằng VND (số nguyên dương, bỏ dấu chấm/phẩy, ví dụ 1480000). Nếu có giảm giá/VAT/phí phục vụ thì lấy số thực trả cuối cùng. Nếu không đọc được số tiền thì trả về 0.',
    '2. "items_summary": Chuỗi tóm tắt ngắn gọn các món chính kèm số lượng (ví dụ: "Lẩu gà (2), Bia Tiger (12), Thuê sân 2h").',
    '3. "suggested_title": Tiêu đề gợi ý ngắn gọn cho buổi (ví dụ: "Nhậu Quán Lẩu Dê 304" hoặc "Tiền sân cầu lông").',
    'Chỉ trả về JSON thuần đúng schema sau, không giải thích thêm:',
    '{"total_amount": 0, "items_summary": "", "suggested_title": ""}'
  ].join('\n');

  var parsed = callGeminiJson_([
    { text: prompt },
    {
      inlineData: {
        mimeType: cleanMime,
        data: cleanBase64
      }
    }
  ]);

  var totalAmount = Math.max(0, Math.round(Number(parsed.total_amount) || 0));
  var itemsSummary = String(parsed.items_summary || '').trim();
  var suggestedTitle = String(parsed.suggested_title || '').trim();

  return {
    total_amount: totalAmount,
    items_summary: itemsSummary,
    suggested_title: suggestedTitle
  };
}
