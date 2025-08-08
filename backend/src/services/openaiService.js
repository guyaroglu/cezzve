const OpenAI = require('openai');
const { cache, CacheKeys } = require('../config/redis');
const logger = require('../utils/logger');

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.OPENAI_MODEL || 'gpt-4';
  }

  // Generate fortune reading with ethical guidelines
  async generateFortune(type, data, userProfile = {}) {
    try {
      const prompt = this.createPrompt(type, data, userProfile);
      
      // Check cache first
      const cacheKey = CacheKeys.OPENAI_RESPONSE(prompt);
      const cachedResponse = await cache.get(cacheKey);
      
      if (cachedResponse) {
        logger.info('OpenAI response served from cache');
        return cachedResponse;
      }

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: 0.8,
        top_p: 0.9,
        frequency_penalty: 0.3,
        presence_penalty: 0.3
      });

      const response = {
        fortune: completion.choices[0].message.content,
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      };

      // Cache for 24 hours
      await cache.set(cacheKey, response, 86400);
      
      logger.info(`OpenAI fortune generated: ${type}`);
      return response;

    } catch (error) {
      logger.error('OpenAI service error:', error);
      
      // Return fallback response on error
      return this.getFallbackResponse(type);
    }
  }

  // Create contextual prompt based on fortune type
  createPrompt(type, data, userProfile) {
    const userName = userProfile.name ? userProfile.name.split(' ')[0] : 'Sevgili';
    const baseContext = `Kullanıcı adı: ${userName}. `;

    switch (type) {
      case 'tarot':
        return `${baseContext}Tarot fal türü: ${data.spread || 'tek kart'}. ${data.question ? `Soru: ${data.question}` : ''} Pozitif ve umut verici bir tarot falı ver. Türkçe olsun.`;
        
      case 'horoscope':
        return `${baseContext}Burç: ${data.sign}. Dönem: ${data.period || 'günlük'}. Bu burç için pozitif ve motivasyonel bir fal ver. Türkçe olsun.`;
        
      case 'palmistry':
        return `${baseContext}El falı özellikleri: ${JSON.stringify(data.features || {})}. Kişilik özelliklerine ve gelecek planlarına odaklanan pozitif bir el falı ver. Türkçe olsun.`;
        
      case 'numerology':
        const birthDate = data.birthDate;
        const fullName = data.fullName;
        return `${baseContext}Doğum tarihi: ${birthDate}. İsim: ${fullName}. Numeroloji analizi yaparak kişilik özellikleri ve yaşam yolu hakkında pozitif öngörüler ver. Türkçe olsun.`;
        
      case 'dream':
        return `${baseContext}Rüya açıklaması: ${data.description}. ${data.emotions ? `Hisler: ${data.emotions.join(', ')}` : ''} Bu rüyanın pozitif anlamını ve mesajını açıkla. Türkçe olsun.`;
        
      default:
        return `${baseContext}Genel bir fal ver. Pozitif ve umut verici olsun. Türkçe olsun.`;
    }
  }

  // System prompt with ethical guidelines
  getSystemPrompt() {
    return `Sen FalYolu uygulaması için fal veren bir yapay zeka asistanısın. Aşağıdaki kurallara sıkı sıkıya uymalısın:

ZORUNLU KURALLAR:
1. HER ZAMAN pozitif, umut verici ve yapıcı dil kullan
2. Asla tıbbi, mali veya hukuki tavsiye verme
3. Kesin ilişki tavsiyelerinden kaçın (örn: "ayrılmalısın")
4. Ölüm, hastalık, kaza gibi korku verici konulardan bahsetme
5. Kültürel hassasiyetleri göz önünde bulundur
6. Her yanıtta "Bu fal sadece eğlence amaçlıdır" şeklinde bir uyarı dahil et
7. Kişisel güçlendirme ve olumlu düşünceye odaklan
8. Türkçe dilbilgisi ve yazım kurallarına uy
9. 150-300 kelime arasında yanıt ver
10. Samimi ama saygılı bir ton kullan

FORMATı:
- Giriş selamlaması
- Ana fal yorumu (pozitif)
- Öneriler ve teşvik edici sözler
- Sorumluluk reddi

ÖRNEK BAŞLANGIÇLAR:
"Sevgili [isim], senin için çok güzel enerjiler görüyorum..."
"Bugün kartlar senin için harika mesajlar taşıyor..."
"Yıldızlar senin lehine güzel bir dönemin başladığını söylüyor..."`;
  }

  // Fallback response when OpenAI is unavailable
  getFallbackResponse(type) {
    const fallbackMessages = {
      tarot: {
        fortune: 'Bugün kartlar senin için güzel mesajlar taşıyor. İç sesin seni doğru yöne yönlendiriyor ve yakında aldığın kararların meyvelerini toplayacaksın. Sabırla ve güvenle ilerlemen gereken bir dönemdesin.',
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      },
      horoscope: {
        fortune: 'Bugün enerjin yüksek ve motivasyonun tam. Yeni fırsatlar kapının çalıyor ve sen bunları değerlendirmeye hazırsın. Sevdiklerinle geçireceğin güzel anlar seni mutlu edecek.',
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      },
      dream: {
        fortune: 'Rüyan bilinçaltından gelen güzel mesajlar taşıyor. İç dünyan sana yeni başlangıçlar ve olumlu değişimler için işaret veriyor. Bu dönemde kendine güvenmen önemli.',
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      },
      numerology: {
        fortune: 'Sayılar senin için güçlü bir dönemin başladığını gösteriyor. Doğal yeteneklerin ve kişiliğin seni başarıya götürecek. Hedeflerine odaklanarak büyük işler başaracaksın.',
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      },
      palmistry: {
        fortune: 'Ellerinin çizgileri senin güçlü karakterini ve parlak geleceğini yansıtıyor. Yaratıcılığın ve kararlılığın seni istediğin yere götürecek. Kendine olan güvenini hiç kaybetme.',
        disclaimer: 'Bu fal sadece eğlence amaçlıdır ve profesyonel tavsiye yerine geçmez.',
        generatedAt: new Date().toISOString(),
        type: type
      }
    };

    return fallbackMessages[type] || fallbackMessages.tarot;
  }

  // Generate personalized AI chat response
  async generateChatResponse(messages, userProfile) {
    try {
      const systemMessage = {
        role: 'system',
        content: `Sen FalYolu uygulamasında kullanıcılarla sohbet eden samimi bir fal uzmanısın. Kullanıcı profili: İsim: ${userProfile.name || 'Bilinmiyor'}, Burç: ${userProfile.preferences?.zodiacSign || 'Bilinmiyor'}. 

KURALLAR:
- Samimi ama profesyonel ol
- Pozitif ve destekleyici ol
- Tıbbi, hukuki, mali tavsiye verme
- Türkçe konuş
- Kısa ve öz yanıtlar ver (50-150 kelime)
- Kullanıcının ismini kullan
- Fal ve astroloji konularında bilgili ol`
      };

      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [systemMessage, ...messages],
        max_tokens: 300,
        temperature: 0.7
      });

      return {
        message: completion.choices[0].message.content,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('OpenAI chat error:', error);
      return {
        message: 'Üzgünüm, şu anda yanıt veremiyorum. Lütfen daha sonra tekrar deneyin.',
        timestamp: new Date().toISOString()
      };
    }
  }

  // Check API usage and limits
  async checkUsage() {
    try {
      // This would be implemented with OpenAI's usage API when available
      return {
        status: 'healthy',
        tokensUsed: 0,
        tokensRemaining: 100000
      };
    } catch (error) {
      logger.error('OpenAI usage check error:', error);
      return {
        status: 'unavailable',
        tokensUsed: 0,
        tokensRemaining: 0
      };
    }
  }
}

module.exports = new OpenAIService();