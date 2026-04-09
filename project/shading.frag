#version 420

// required by GLSL spec Sect 4.5.3 (though nvidia does not, amd does)
precision highp float;

///////////////////////////////////////////////////////////////////////////////
// Material
///////////////////////////////////////////////////////////////////////////////
uniform vec3 material_color = vec3(1, 1, 1);
uniform float material_metalness = 0;
uniform float material_fresnel = 0;
uniform float material_shininess = 0;
uniform float material_emission = 0;

uniform int has_color_texture = 0;
layout(binding = 0) uniform sampler2D colorMap;
uniform int has_fresnel_texture = 0;
layout(binding = 3) uniform sampler2D fresnelMap;
uniform int has_shininess_texture = 0;
layout(binding = 4) uniform sampler2D shininessMap;
uniform int has_emission_texture = 0;
layout(binding = 5) uniform sampler2D emissiveMap;

///////////////////////////////////////////////////////////////////////////////
// Environment
///////////////////////////////////////////////////////////////////////////////
layout(binding = 6) uniform sampler2D environmentMap;
layout(binding = 7) uniform sampler2D irradianceMap;
layout(binding = 8) uniform sampler2D reflectionMap;
uniform float environment_multiplier;

///////////////////////////////////////////////////////////////////////////////
// Light source
///////////////////////////////////////////////////////////////////////////////
uniform vec3 point_light_color = vec3(1.0, 1.0, 1.0);
uniform float point_light_intensity_multiplier = 50.0;

uniform int useSpotLight = 0;
uniform int useSoftFalloff = 1;
uniform vec3 viewSpaceLightDir;
uniform float spotOuterAngle = 20;
uniform float spotInnerAngle = 18;

//in vec4 shadowMapCoord;
//layout(binding = 10) uniform sampler2DShadow shadowMapTex;

///////////////////////////////////////////////////////////////////////////////
// Constants
///////////////////////////////////////////////////////////////////////////////
#define PI 3.14159265359

///////////////////////////////////////////////////////////////////////////////
// Input varyings from vertex shader
///////////////////////////////////////////////////////////////////////////////
in vec2 texCoord;
in vec3 viewSpaceNormal;
in vec3 viewSpacePosition;

///////////////////////////////////////////////////////////////////////////////
// Input uniform variables
///////////////////////////////////////////////////////////////////////////////
uniform mat4 viewInverse;
uniform vec3 viewSpaceLightPosition;

///////////////////////////////////////////////////////////////////////////////
// Output color
///////////////////////////////////////////////////////////////////////////////
layout(location = 0) out vec4 fragmentColor;



vec3 calculateDirectIllumiunation(vec3 wo, vec3 n, vec3 base_color, float fresnel, float shininess)
{
	vec3 direct_illum = base_color;
	///////////////////////////////////////////////////////////////////////////
	// Task 1.2 - Calculate the radiance Li from the light, and the direction
	//            to the light. If the light is backfacing the triangle,
	//            return vec3(0);
	///////////////////////////////////////////////////////////////////////////

	float d = length(viewSpaceLightPosition - viewSpacePosition);
	vec3 Li = point_light_intensity_multiplier * point_light_color * (1.0 / (d * d));
	vec3 wi = normalize(viewSpaceLightPosition - viewSpacePosition);

	if (dot(wi,n) <= 0.0) { // light is backfacing
		return vec3(0.0);
	}

	///////////////////////////////////////////////////////////////////////////
	// Task 1.3 - Calculate the diffuse term and return that as the result
	///////////////////////////////////////////////////////////////////////////
	
	vec3 diffuse_term = base_color * (1.0/ PI) * dot(n, wi) * Li;

	//direct_illum = diffuse_term;

	///////////////////////////////////////////////////////////////////////////
	// Task 2 - Calculate the Torrance Sparrow BRDF and return the light
	//          reflected from that instead
	///////////////////////////////////////////////////////////////////////////

	vec3 wh = normalize(wi + wo); // half vector

	float ndotwh = max(0.0001, dot(n, wh));
	float ndotwo = max(0.0001, dot(n, wo));
	float wodotwh = max(0.0001, dot(wo, wh));

	float s = shininess;
	
	// Fresnel term (F)
	float F = fresnel + (1 - fresnel) * pow(1 - dot(wh, wi), 5);
	// Microfacet distribution function (D), 
	float D = (s+2) / (2*PI) * pow(ndotwh, s);
	// Shadowing/Masking Function (G)
	float G = min(1.0, min((2.0 * ndotwh * ndotwo)/(wodotwh), (2.0 * ndotwh * dot(n,wi))/(wodotwh)));
	
	float brdf = (F * D * G) / (4.0 * clamp(ndotwo * dot(n, wi), 0.0001, 1.0)); 

	//return brdf * dot(n, wi) * Li;

	///////////////////////////////////////////////////////////////////////////
	// Task 3 - Make your shader respect the parameters of our material model.
	///////////////////////////////////////////////////////////////////////////

	// dielectric materials scatter colored light, (internal bouncing)
	vec3 dielectric_term = brdf * dot(n, wi) * Li + (1 - F) * diffuse_term;

	// metal reflections reflect some color
	vec3 metal_term = brdf * base_color * dot(n, wi) * Li;

	// mix the two terms based on the metalness
	direct_illum = material_metalness * metal_term + (1.0 - material_metalness) * dielectric_term;

	return direct_illum;
}

vec3 calculateIndirectIllumination(vec3 wo, vec3 n, vec3 base_color, float fresnel, float shininess)
{
	vec3 indirect_illum = vec3(0.f);
	///////////////////////////////////////////////////////////////////////////
	// Task 5 - Lookup the irradiance from the irradiance map and calculate
	//          the diffuse reflection
	///////////////////////////////////////////////////////////////////////////

	// Calculate the normal in world-space
	vec3 n_ws = vec3(viewInverse * vec4(n, 0.0));

	// Calculate the spherical coordinates of the direction
	float theta = acos(max(-1.0f, min(1.0f, n_ws.y)));
	float phi = atan(n_ws.z, n_ws.x);
	if(phi < 0.0f)
	{
		phi = phi + 2.0f * PI;
	}

	// Use these to lookup the color in the environment map
	vec2 lookup = vec2(phi / (2.0 * PI), 1 - theta / PI);
	vec3 Li = environment_multiplier * texture(irradianceMap, lookup).rgb;

	vec3 diffuse_term = base_color * (1.0 / PI) * Li;

	// indirect_illum = diffuse_term;

	///////////////////////////////////////////////////////////////////////////
	// Task 6 - Look up in the reflection map from the perfect specular
	//          direction and calculate the dielectric and metal terms.
	///////////////////////////////////////////////////////////////////////////

	vec3 wi = normalize(reflect(-wo, n));
	vec3 wi_ws = normalize(viewInverse * vec4(wi, 0.0)).xyz;

	theta = acos(max(-1.0f, min(1.0f, wi_ws.y)));
	phi = atan(wi_ws.z, wi_ws.x);
	if(phi < 0.0f)
	{
		phi = phi + 2.0f * PI;
	}
	lookup = vec2(phi / (2.0 * PI), 1 - theta / PI);


	float roughness = sqrt(sqrt(2.0 / (shininess + 2.0)));
	Li = environment_multiplier * textureLod(reflectionMap, lookup, roughness * 7.0).rgb;

	vec3 wh = normalize(wi + wo);
	float F = fresnel + (1 - fresnel) * pow(1 - dot(wh, wo), 5);

	vec3 dielectric_term = F * Li + (1-F) * diffuse_term;
	vec3 metal_term = F * base_color * Li;

	vec3 microfacet_term = material_metalness * metal_term + (1.0 - material_metalness) * dielectric_term;

	indirect_illum = microfacet_term;

	return indirect_illum;
}

void main()
{
	float visibility = 1.0;
	float attenuation = 1.0;
	float spotAttenuation = 1.0;

	
	//visibility = textureProj(shadowMapTex, shadowMapCoord);
	// Task 6 - spotlight stuff ////////////////////////////////////////////
	//if(useSpotLight == 1)
	//{
	//	vec3 posToLight = normalize(viewSpaceLightPosition - viewSpacePosition);
	//	float cosAngle = dot(posToLight, -viewSpaceLightDir);
	//	
	//	if(useSoftFalloff == 0)
	//	{
	//		// Spotlight with hard border:
	//		spotAttenuation = (cosAngle > spotOuterAngle) ? 1.0 : 0.0;
	//	}
	//	else
	//	{
	//		// Spotlight with soft border:
	//		spotAttenuation = smoothstep(spotOuterAngle, spotInnerAngle, cosAngle);
	//	}
	//	visibility *= spotAttenuation;
	//}

	vec3 wo = -normalize(viewSpacePosition);
	vec3 n = normalize(viewSpaceNormal);

	vec3 base_color = material_color;
	if(has_color_texture == 1)
	{
		base_color = base_color * texture(colorMap, texCoord).rgb;
	}
	float fragment_fresnel = material_fresnel;
	if(has_fresnel_texture == 1)
	{
		fragment_fresnel = texture(fresnelMap, texCoord).r;
	}
	float fragment_shininess = material_shininess;
	if(has_shininess_texture == 1)
	{
		fragment_shininess = texture(shininessMap, texCoord).r*2500;
	}

	// Direct illumination	
	vec3 direct_illumination_term = visibility * calculateDirectIllumiunation(wo, n, base_color, fragment_fresnel, fragment_shininess);

	// Indirect illumination
	vec3 indirect_illumination_term = calculateIndirectIllumination(wo, n, base_color, fragment_fresnel, fragment_shininess);

	///////////////////////////////////////////////////////////////////////////
	// Add emissive term. If emissive texture exists, sample this term.
	///////////////////////////////////////////////////////////////////////////
	vec3 emission_term = material_emission * material_color;
	if(has_emission_texture == 1)
	{
		emission_term = texture(emissiveMap, texCoord).rgb;
	}

	vec3 shading = direct_illumination_term + indirect_illumination_term + emission_term;

	fragmentColor = vec4(shading, 1.0); 
	return;
}
