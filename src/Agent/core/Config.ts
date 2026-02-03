export class Config {
  defaultProvider: string;
  defaultModel: string;
  baseUrl: string;
  apiKey: string;
  stream: boolean;
  temperature: number;
  maxTokens?: number;

  constructor({
    defaultProvider,
    defaultModel,
    baseUrl,
    apiKey,
    stream,
    temperature,
    maxTokens,
    maxSteps,
  }: {
    defaultProvider: string;
    defaultModel: string;
    baseUrl: string;
    apiKey: string;
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
    maxSteps?: number;
  }) {
    this.defaultProvider = defaultProvider;
    this.defaultModel = defaultModel;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.stream = stream ? stream : false;
    this.temperature = temperature ? temperature : 0.5;
    this.maxTokens = maxTokens;
  }
}
