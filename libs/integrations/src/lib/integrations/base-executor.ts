import { Pezzo } from "@pezzo/client";

import { GraphQLFormattedError } from "graphql";
import { interpolateVariables } from "../utils/interpolate-variables";
import { PezzoClientError } from "./types";

export interface ExecuteProps<T = unknown> {
  content: string;
  settings: T;
  options?: ExecuteOptions;
}

export interface ExecuteOptions {
  autoParseJSON?: boolean;
}

export interface ExecuteResult<T> {
  status: "Success" | "Error";
  promptTokens: number;
  completionTokens: number;
  promptCost: number;
  completionCost: number;
  error?: {
    error: unknown;
    message?: string;
    printableError: string;
    status: number;
  };
  result?: T;
}

export abstract class BaseExecutor {
  private pezzoClient: Pezzo;

  constructor(pezzoClient: Pezzo) {
    this.pezzoClient = pezzoClient;
  }

  abstract execute(props: ExecuteProps): Promise<ExecuteResult<string>>;

  private getPrompt(promptName: string) {
    try {
      return this.pezzoClient.findPrompt(promptName);
    } catch (error) {
      throw new PezzoClientError<GraphQLFormattedError>(error.message, error);
    }
  }

  private getPromptVersion<T>(promptId: string) {
    try {
      return this.pezzoClient.getDeployedPromptVersion<T>(promptId);
    } catch (error) {
      throw new PezzoClientError<GraphQLFormattedError>(error.message, error);
    }
  }

  async run<T>(
    promptName: string,
    variables: Record<string, string> = {},
    options: ExecuteOptions = {}
  ) {
    const prompt = await this.getPrompt(promptName);
    const promptVersion = await this.getPromptVersion<T>(prompt.id);
    const { settings, content } = promptVersion;
    const interpolatedContent = interpolateVariables(content, variables);
    const start = performance.now();

    const executionResult = await this.execute({
      content: interpolatedContent,
      settings: {
        model: settings.model,
        modelSettings: settings.modelSettings,
      },
      options,
    });

    if (executionResult.error) {
      const {
        error: { error, status },
      } = executionResult;

      throw new PezzoClientError(
        "Prompt execution failed. Check the Pezzo History to see what went wrong.",
        error,
        status
      );
    }

    const end = performance.now();
    const duration = Math.ceil(end - start);

    const promptConnect = {
      connect: {
        id: prompt.id,
      },
    };

    try {
      return this.pezzoClient.reportPromptExecution<T>(
        {
          prompt: promptConnect,
          promptVersionSha: promptVersion.sha,
          status: executionResult.status,
          content,
          variables,
          interpolatedContent,
          settings,
          result: executionResult.result,
          ...(executionResult.error && {
            error: executionResult?.error.printableError,
          }),
          promptTokens: executionResult.promptTokens,
          completionTokens: executionResult.completionTokens,
          totalTokens:
            executionResult.promptTokens + executionResult.completionTokens,
          promptCost: executionResult.promptCost,
          completionCost: executionResult.completionCost,
          totalCost:
            executionResult.promptCost + executionResult.completionCost,
          duration,
        },
        options.autoParseJSON
      );
    } catch (e) {
      this.pezzoClient.reportPromptExecution<T>({
        prompt: promptConnect,
        promptVersionSha: promptVersion.sha,
        status: "Error",
        content,
        variables,
        interpolatedContent,
        settings,
        ...(executionResult.error && {
          error: executionResult?.error.printableError,
        }),
        promptTokens: executionResult.promptTokens,
        completionTokens: executionResult.completionTokens,
        totalTokens:
          executionResult.promptTokens + executionResult.completionTokens,
        promptCost: executionResult.promptCost,
        completionCost: executionResult.completionCost,
        totalCost: executionResult.promptCost + executionResult.completionCost,
        duration,
      });
      throw e;
    }
  }
}