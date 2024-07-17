import {Tracer} from '@opentelemetry/sdk-trace-base';
const { SimpleSpanProcessor } = require( '@opentelemetry/sdk-trace-base');
const { WebTracerProvider } = require( '@opentelemetry/sdk-trace-web');
const { XMLHttpRequestInstrumentation } = require( '@opentelemetry/instrumentation-xml-http-request');
const { ZoneContextManager } = require( '@opentelemetry/context-zone');
const { OTLPTraceExporter } = require( '@opentelemetry/exporter-trace-otlp-http');
import { W3CTraceContextPropagator } from '@opentelemetry/core';
const { registerInstrumentations } = require( '@opentelemetry/instrumentation');
const { Resource } = require('@opentelemetry/resources');
const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

import {FetchInstrumentation} from '@opentelemetry/instrumentation-fetch';
// import {DocumentLoadInstrumentation} from '@opentelemetry/instrumentation-document-load';
// import {UserInteractionInstrumentation} from '@opentelemetry/instrumentation-user-interaction';

let WEB_TRACER_WITH_ZONE: any;
export function initWebTracerWithZone (openTelemetryConfig): Tracer {
  console.log('init WebTracer With Zone', openTelemetryConfig);
  if (WEB_TRACER_WITH_ZONE) {
    return WEB_TRACER_WITH_ZONE;
  }
  const providerWithZone = new WebTracerProvider({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: openTelemetryConfig.serviceName
    })
  });

// Note: For production consider using the "BatchSpanProcessor" to reduce the number of requests
// to your exporter. Using the SimpleSpanProcessor here as it sends the spans immediately to the
// exporter without delay
//   providerWithZone.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  providerWithZone.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({
    // url: 'http://localhost:4318/v1/traces',
    url: openTelemetryConfig.collectorEndpoint
  })));

  providerWithZone.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  registerInstrumentations({
    instrumentations: [
      // new DocumentLoadInstrumentation(),
      // new UserInteractionInstrumentation(),
      new XMLHttpRequestInstrumentation({
        ignoreUrls: openTelemetryConfig.ignoreUrls,
        propagateTraceHeaderCorsUrls: openTelemetryConfig.propagateTraceHeaderCorsUrls
      }),
      new FetchInstrumentation({
        ignoreUrls: openTelemetryConfig.ignoreUrls,
        propagateTraceHeaderCorsUrls: openTelemetryConfig.propagateTraceHeaderCorsUrls ///.*/, // 设置跨域请求时需要传播 trace 头部的 URL
      }),
    ],
  });

  const webTracerWithZone = providerWithZone.getTracer(openTelemetryConfig.tracerName);
  // window.webTracerWithZone = webTracerWithZone;
  WEB_TRACER_WITH_ZONE = webTracerWithZone;
  return webTracerWithZone;
}

export function aggregateExecutionTime(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  // if (!WEB_TRACER_WITH_ZONE) {
  //   throw Error('Please init openTelemetry first.');
  // }
  const originalMethod = descriptor.value;

  descriptor.value = function (...args: any[]) {
    const span = WEB_TRACER_WITH_ZONE.startSpan(`Executing ${propertyKey}`);
    const startTime = Date.now();

    const finishSpan = (result: any) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      span.setAttribute('execution.duration', duration);
      span.end();
      return result;
    };

    try {
      const result = originalMethod.apply(this, args);
      if (result instanceof Promise) {
        return result.then((res: any) => finishSpan(res)).catch((err: any) => {
          span.recordException(err);
          span.end();
          throw err;
        });
      } else {
        return finishSpan(result);
      }
    } catch (error) {
      span.recordException(error);
      span.end();
      throw error;
    }
  };

  return descriptor;
}
