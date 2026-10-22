import type { FastifyPluginAsync } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';

import { ApiError } from '../lib/api-error.js';
import { OpenApiTags } from '../openapi.js';
import { ErrorSchema } from '../schemas/common.js';
import { cebuCityCenter, type GeocoderService } from '../services/geocoder-service.js';

export interface PlaceRoutesOptions {
  geocoderService: GeocoderService;
}

const PlaceSchema = Type.Object({
  id: Type.String({ examples: ['osm:N:123456'] }),
  name: Type.String(),
  label: Type.String(),
  lat: Type.Number(),
  lng: Type.Number(),
});

export const placeRoutes: FastifyPluginAsync<PlaceRoutesOptions> = async (instance, options) => {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();

  fastify.get(
    '/places/search',
    {
      preHandler: (request, reply) => fastify.authenticate(request, reply),
      // Per user after authentication: each call spends third-party provider capacity.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) => request.currentUser?.id ?? request.ip,
        },
      },
      schema: {
        tags: [OpenApiTags.placeSearch],
        operationId: 'searchPlaces',
        summary: 'Search places by name',
        description:
          'Any authenticated role. Server-side geocoder proxy biased to the Philippines; clients never call the provider directly. Returns only id/name/label/lat/lng and the attribution clients must display. Queries and coordinates are not stored or logged. 503 GEOCODER_UNAVAILABLE when the provider is disabled or failing; route search and discovery keep working.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object(
          {
            q: Type.String({ minLength: 2, maxLength: 120, examples: ['Ayala Center Cebu'] }),
            lat: Type.Optional(Type.Number({ minimum: 4.0, maximum: 21.5 })),
            lng: Type.Optional(Type.Number({ minimum: 116.0, maximum: 127.0 })),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Object({ places: Type.Array(PlaceSchema), attribution: Type.String() }),
          400: ErrorSchema,
          401: ErrorSchema,
          429: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (request) => {
      const { lat, lng } = request.query;
      if ((lat === undefined) !== (lng === undefined)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'lat and lng must be provided together');
      }
      const q = request.query.q.trim();
      if (q.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'q must contain at least 2 characters');
      const bias = lat === undefined || lng === undefined ? cebuCityCenter : { lat, lng };
      const places = await options.geocoderService.search(q, bias, request.query.limit ?? 5);
      return { places, attribution: '© OpenStreetMap contributors' };
    },
  );
};
