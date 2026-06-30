#!/bin/sh
set -eu

/app/next_stage >/tmp/oracle-stage-1.log
/app/next_stage >/tmp/oracle-stage-2.log
/app/next_stage >/tmp/oracle-stage-3.log

mkdir -p outputs

cat > outputs/prediction.json <<'JSON'
{
  "predictions": [
    {
      "checkpoint_id": "cal_quarterly_002",
      "evidence": {
        "habits_state:budget_review": [
          {
            "app_log_id": "log_00003",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00017",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00033",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:client_technical_briefing": [
          {
            "app_log_id": "log_00010",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00022",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00041",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:family_movie_night": [
          {
            "app_log_id": "log_00213",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00215",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00235",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:home_strength_training": [
          {
            "app_log_id": "log_00182",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00196",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00205",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:industry_news_review": [
          {
            "app_log_id": "log_00008",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00020",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00039",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:investment_transfer": [
          {
            "app_log_id": "log_00002",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00062",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00126",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:mental_health_therapy": [
          {
            "app_log_id": "log_00024",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00054",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00078",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:monthly_hoa_meeting": [
          {
            "app_log_id": "log_00040",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00108",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00159",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:neighbor_walk_chat": [
          {
            "app_log_id": "log_00004",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00016",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00018",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:spouse_date_night": [
          {
            "app_log_id": "log_00027",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00055",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00079",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:sunday_family_dinner": [
          {
            "app_log_id": "log_00005",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00019",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00037",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:tax_document_organization": [
          {
            "app_log_id": "log_00184",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00185",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00221",
            "evidence_content": "oracle evidence id"
          }
        ],
        "habits_state:weekend_neighborhood_walk": [
          {
            "app_log_id": "log_00001",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00014",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00083",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:capital_allocation": [
          {
            "app_log_id": "log_00043",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00125",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00194",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:community_involvement_type": [
          {
            "app_log_id": "log_00066",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00082",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:fitness_philosophy": [
          {
            "app_log_id": "log_00021",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00080",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00110",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:health_management_approach": [
          {
            "app_log_id": "log_00094",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00095",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:learning_modality": [
          {
            "app_log_id": "log_00025",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00137",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:leisure_activity_type": [
          {
            "app_log_id": "log_00036",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00203",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00227",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:material_acquisition": [
          {
            "app_log_id": "log_00374",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00394",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:shared_activity_planning": [
          {
            "app_log_id": "log_00144",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00242",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00250",
            "evidence_content": "oracle evidence id"
          }
        ],
        "preferences_state:social_interaction_format": [
          {
            "app_log_id": "log_00029",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00069",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00128",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:community_memberships": [
          {
            "app_log_id": "log_00066",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00023",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00092",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:home_infrastructure_assets": [
          {
            "app_log_id": "log_00034",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00145",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00262",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:industry_software_skills": [
          {
            "app_log_id": "log_00053",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00149",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00243",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:insurance_portfolio": [
          {
            "app_log_id": "log_00077",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:leisure_hardware": [
          {
            "app_log_id": "log_00101",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00015",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00118",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:main_investment_account": [
          {
            "app_log_id": "log_00091",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00158",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:main_tech_tool": [
          {
            "app_log_id": "log_00042",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00113",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:primary_family_vehicle": [
          {
            "app_log_id": "log_00100",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:primary_health_focus": [
          {
            "app_log_id": "log_00012",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00087",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00188",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:primary_residence_mortgage": [
          {
            "app_log_id": "log_00052",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00065",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00117",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:professional_certifications": [
          {
            "app_log_id": "log_00063",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00107",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00197",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:professional_memberships": [
          {
            "app_log_id": "log_00063",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:recovery_tools": [
          {
            "app_log_id": "log_00007",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00038",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00064",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:social_digital_platforms": [
          {
            "app_log_id": "log_00115",
            "evidence_content": "oracle evidence id"
          },
          {
            "app_log_id": "log_00162",
            "evidence_content": "oracle evidence id"
          }
        ],
        "user_attributes_state:travel_equipment": [
          {
            "app_log_id": "log_00150",
            "evidence_content": "oracle evidence id"
          }
        ]
      },
      "rq3_apply_answers": {
        "habits_state:budget_review": {
          "items": [
            {
              "answer": "Your weekly budget review is scheduled for 09:30 today. Since Sunday is the scheduled day, it is almost time to get started.",
              "evidence": [
                {
                  "app_log_id": "log_00003",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00017",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00033",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:client_technical_briefing": {
          "items": [
            {
              "answer": "Your weekly client technical briefing is at 10:00 today at the regional corporate headquarters. Since Tuesday is the scheduled day, it is almost time to get ready.",
              "evidence": [
                {
                  "app_log_id": "log_00010",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00022",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00041",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:family_movie_night": {
          "items": [
            {
              "answer": "Your weekly family movie night is scheduled for 19:30 tonight. Since it is Saturday, it is almost time to pick a film and get settled.",
              "evidence": [
                {
                  "app_log_id": "log_00213",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00215",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00235",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:home_strength_training": {
          "items": [
            {
              "answer": "Your weekly home strength training in the basement home gym starts at 06:45 and runs until 07:30. Since Wednesday is one of the scheduled days, it is almost time to begin.",
              "evidence": [
                {
                  "app_log_id": "log_00182",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00196",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00205",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:industry_news_review": {
          "items": [
            {
              "answer": "Your weekly industry news review is scheduled for 08:00 today. Since it is Monday, it is almost time to start catching up on the latest updates.",
              "evidence": [
                {
                  "app_log_id": "log_00008",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00020",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00039",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:investment_transfer": {
          "items": [
            {
              "answer": "Since it is the 1st of the month, your monthly investment transfer is scheduled for 09:00. It is almost time to take care of that.",
              "evidence": [
                {
                  "app_log_id": "log_00002",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00062",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00126",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:mental_health_therapy": {
          "items": [
            {
              "answer": "Since it is Wednesday, your biweekly mental health therapy session is scheduled for today in your home office via telehealth. It is almost time to log on for your session.",
              "evidence": [
                {
                  "app_log_id": "log_00024",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00054",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00078",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:monthly_hoa_meeting": {
          "items": [
            {
              "answer": "Your monthly HOA meeting at the Wexford community center hall is scheduled for 12:00. Since it is the third Monday of the month, it is time to get ready to go.",
              "evidence": [
                {
                  "app_log_id": "log_00040",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00108",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00159",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:neighbor_walk_chat": {
          "items": [
            {
              "answer": "Your weekly neighbor walk and chat is scheduled for 13:00 to 14:00 today on the neighborhood sidewalks near Wexford Park. Since Saturday and Sunday are your scheduled days, it is almost time to head out.",
              "evidence": [
                {
                  "app_log_id": "log_00004",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00016",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00018",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:spouse_date_night": {
          "items": [
            {
              "answer": "Your biweekly spouse date night is scheduled for 20:00 tonight. Since it is Thursday, it is time to choose one of the various local Pittsburgh restaurants and prepare for the evening.",
              "evidence": [
                {
                  "app_log_id": "log_00027",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00055",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00079",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:sunday_family_dinner": {
          "items": [
            {
              "answer": "Your weekly Sunday family dinner is scheduled from 14:30 to 16:30 in the family home dining room. Since it is Sunday afternoon, it is almost time to get started.",
              "evidence": [
                {
                  "app_log_id": "log_00005",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00019",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00037",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:tax_document_organization": {
          "items": [
            {
              "answer": "Your weekly tax document organization is set for 19:30 in the home office. Since Monday is the scheduled day, it is almost time to begin.",
              "evidence": [
                {
                  "app_log_id": "log_00184",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00185",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00221",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "habits_state:weekend_neighborhood_walk": {
          "items": [
            {
              "answer": "Your weekly weekend neighborhood walk on the suburban neighborhood sidewalks is scheduled for 06:30 to 07:30. Since it is Saturday, it is almost time to head out.",
              "evidence": [
                {
                  "app_log_id": "log_00001",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00014",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00083",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "user_communication",
              "status": "valid"
            }
          ]
        },
        "preferences_state:capital_allocation": {
          "items": [
            {
              "answer": {
                "investment_search_criteria": {
                  "execution_method": "automated investment strategies",
                  "preferred_vehicle_types": "tax-advantaged savings vehicles"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00043",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00125",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00194",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:community_involvement_type": {
          "items": [
            {
              "answer": {
                "community_engagement_filters": {
                  "activity_focus": "outcome-oriented civic activities such as infrastructure projects",
                  "excluded_types": "social-only community mixers"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00066",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00082",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:fitness_philosophy": {
          "items": [
            {
              "answer": {
                "workout_search_filters": {
                  "avoid_format": "flexible, social",
                  "program_features": "structured, metric-heavy, home, progression tracking"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00021",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00080",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00110",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:health_management_approach": {
          "items": [
            {
              "answer": {
                "provider_filters": {
                  "approach": "preventative",
                  "delivery_setting": "home-based"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00094",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00095",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:learning_modality": {
          "items": [
            {
              "answer": {
                "learning_catalog_filters": {
                  "excluded_settings": "large-scale, high-level industry conferences",
                  "preferred_modalities": "in-depth, self-paced technical white papers and webinars"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00025",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00137",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:leisure_activity_type": {
          "items": [
            {
              "answer": {
                "workshop_search_filters": {
                  "hobby_category": "skill-based productive hobbies",
                  "specific_interest": "precision woodworking"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00036",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00203",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00227",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:material_acquisition": {
          "items": [
            {
              "answer": {
                "catalog_search_filters": {
                  "quality_tier": "premium durable",
                  "tech_integration": "smart-tech"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00374",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00394",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:shared_activity_planning": {
          "items": [
            {
              "answer": {
                "activity_filters": {
                  "engagement_priority": "consistent participation from teenagers",
                  "format_type": "scheduled, technology-facilitated family activities"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00144",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00242",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00250",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "preferences_state:social_interaction_format": {
          "items": [
            {
              "answer": {
                "event_search_criteria": {
                  "excluded_formats": "digital or virtual gatherings",
                  "interaction_mode": "in-person social interactions"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00029",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00069",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00128",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "information_request_construction",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:community_memberships": {
          "items": [
            {
              "answer": {
                "professional_membership": {
                  "description": "industry-focused professional networking community",
                  "organization_name": "American Coatings Association"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00023",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00031",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00049",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:home_infrastructure_assets": {
          "items": [
            {
              "answer": {
                "security_device_registration": {
                  "device_model": "Ring Video Doorbell Pro 2",
                  "installation_purpose": "Hardwired security monitoring for main entry"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00034",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00145",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00262",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:industry_software_skills": {
          "items": [
            {
              "answer": {
                "software_skill_entry": {
                  "proficiency_details": "advanced level for timeline and resource management",
                  "software_name": "Microsoft Project"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00053",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00149",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00243",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:insurance_portfolio": {
          "items": [
            {
              "answer": {
                "liability_insurance_entry": {
                  "coverage_details": "$1M liability coverage for personal asset protection",
                  "policy_description": "State Farm Umbrella Policy"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00077",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:leisure_hardware": {
          "items": [
            {
              "answer": {
                "workshop_tool_registration": {
                  "model_name": "SawStop Professional Cabinet Saw",
                  "primary_use": "precision woodworking"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00101",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00015",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00118",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:main_investment_account": {
          "items": [
            {
              "answer": {
                "account_connection_details": {
                  "account_description": "Managed brokerage account focused on diversified ETFs",
                  "institution_name": "Vanguard Personal Advisor Services"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00091",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00158",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:main_tech_tool": {
          "items": [
            {
              "answer": {
                "software_integration_config": {
                  "erp_platform": "SAP ERP",
                  "functional_scope": "project tracking, resource allocation, and budget management"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00042",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00113",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:primary_family_vehicle": {
          "items": [
            {
              "answer": {
                "parking_permit_application": {
                  "vehicle_details": {
                    "usage_intent": "carpooling and family errands",
                    "vehicle_description": "2022 Honda Odyssey"
                  }
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00100",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:primary_health_focus": {
          "items": [
            {
              "answer": {
                "fitness_profile_setup": {
                  "desired_outcome": "permanently resolve sedentary-related back pain",
                  "training_focus": "Developing core and posterior chain strength"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00012",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00087",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00188",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:primary_residence_mortgage": {
          "items": [
            {
              "answer": {
                "mortgage_account_configuration": {
                  "loan_identity": "15-year fixed-rate mortgage through Rocket Mortgage",
                  "payment_specification": "2.875% APR, $2,450 monthly payment"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00052",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00065",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00117",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:professional_certifications": {
          "items": [
            {
              "answer": {
                "contractor_profile_update": {
                  "certification_title": "EPA Environmental Compliance Certification for Industrial Coatings",
                  "regulatory_focus": "VOC regulation and reporting"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00063",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00107",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00197",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:professional_memberships": {
          "items": [
            {
              "answer": {
                "professional_profile_update": {
                  "affiliation": {
                    "organization": "Association for Materials Protection and Performance (AMPP)",
                    "status": "national member"
                  }
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00063",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:recovery_tools": {
          "items": [
            {
              "answer": {
                "recovery_tool_entry": {
                  "model_name": "Bowflex SelectTech 552",
                  "tool_category": "Adjustable dumbbells"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00007",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00038",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00064",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:social_digital_platforms": {
          "items": [
            {
              "answer": {
                "social_connectivity_setup": {
                  "platform_name": "Facebook",
                  "usage_intent": "keeping in touch with extended family and high school friends"
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00115",
                  "evidence_content": "oracle evidence id"
                },
                {
                  "app_log_id": "log_00162",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        },
        "user_attributes_state:travel_equipment": {
          "items": [
            {
              "answer": {
                "insurance_application": {
                  "personal_property_details": {
                    "item_count": "4",
                    "luggage_description": "hard-shell Samsonite suitcases"
                  }
                }
              },
              "evidence": [
                {
                  "app_log_id": "log_00150",
                  "evidence_content": "oracle evidence id"
                }
              ],
              "qa_id": "q1",
              "service_family": "action_configuration",
              "status": "valid"
            }
          ]
        }
      },
      "snapshot_state": {
        "habits_state:budget_review": {
          "schedule": {
            "days_of_week": [
              6
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "start_time": "09:30"
          }
        },
        "habits_state:client_technical_briefing": {
          "location": "regional corporate headquarters",
          "schedule": {
            "days_of_week": [
              1
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "start_time": "10:00"
          }
        },
        "habits_state:family_movie_night": {
          "schedule": {
            "days_of_week": [
              5
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "start_time": "19:30"
          }
        },
        "habits_state:home_strength_training": {
          "location": "basement home gym",
          "schedule": {
            "days_of_week": [
              0,
              2,
              4
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "end_time": "07:30",
            "start_time": "06:45"
          }
        },
        "habits_state:industry_news_review": {
          "schedule": {
            "days_of_week": [
              0
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "start_time": "08:00"
          }
        },
        "habits_state:investment_transfer": {
          "schedule": {
            "days_of_month": [
              1
            ],
            "frequency_type": "monthly_by_date"
          },
          "timing": {
            "start_time": "09:00"
          }
        },
        "habits_state:mental_health_therapy": {
          "location": "home office via telehealth",
          "schedule": {
            "days_of_week": [
              2
            ],
            "frequency_type": "biweekly"
          }
        },
        "habits_state:monthly_hoa_meeting": {
          "location": "Wexford community center hall",
          "schedule": {
            "day_of_week": 0,
            "frequency_type": "monthly_nth_weekday",
            "week_of_month": 3
          },
          "timing": {
            "start_time": "12:00"
          }
        },
        "habits_state:neighbor_walk_chat": {
          "location": "neighborhood sidewalks near Wexford Park",
          "schedule": {
            "days_of_week": [
              5,
              6
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "end_time": "14:00",
            "start_time": "13:00"
          }
        },
        "habits_state:spouse_date_night": {
          "location": "various local Pittsburgh restaurants",
          "schedule": {
            "days_of_week": [
              3
            ],
            "frequency_type": "biweekly",
            "start_date": "2024-01-11"
          },
          "timing": {
            "start_time": "20:00"
          }
        },
        "habits_state:sunday_family_dinner": {
          "location": "family home dining room",
          "schedule": {
            "days_of_week": [
              6
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "end_time": "16:30",
            "start_time": "14:30"
          }
        },
        "habits_state:tax_document_organization": {
          "location": "home office",
          "schedule": {
            "days_of_week": [
              0
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "start_time": "19:30"
          }
        },
        "habits_state:weekend_neighborhood_walk": {
          "location": "suburban neighborhood sidewalks",
          "schedule": {
            "days_of_week": [
              5,
              6
            ],
            "frequency_type": "weekly"
          },
          "timing": {
            "end_time": "07:30",
            "start_time": "06:30"
          }
        },
        "preferences_state:capital_allocation": {
          "from": {
            "statement": "Prefers long-term capital preservation and tax-efficient growth over high-risk speculative trading"
          },
          "to": {
            "statement": "Strongly prefers tax-advantaged savings vehicles and automated investment strategies to ensure consistency in long-term wealth building"
          }
        },
        "preferences_state:community_involvement_type": {
          "statement": "Prefers outcome-oriented civic activities like infrastructure projects over social-only community mixers"
        },
        "preferences_state:fitness_philosophy": {
          "from": {
            "statement": "Prefers data-driven, quantifiable health tracking over intuitive or group-based fitness classes"
          },
          "to": {
            "statement": "Strongly prefers highly structured, metric-heavy home workouts with clear progression tracking over flexible or social exercise"
          }
        },
        "preferences_state:health_management_approach": {
          "statement": "Prefers preventative, home-based care routines over reactive clinical visits for minor issues"
        },
        "preferences_state:learning_modality": {
          "statement": "Prefers in-depth, self-paced technical white papers and webinars over large-scale, high-level industry conferences"
        },
        "preferences_state:leisure_activity_type": {
          "from": {
            "statement": "Prefers productive, hands-on hobbies like woodworking over passive media consumption during weekends"
          },
          "to": {
            "statement": "Strongly prefers skill-based productive hobbies like precision woodworking, viewing them as essential mental decompression from his corporate role"
          }
        },
        "preferences_state:material_acquisition": {
          "statement": "Favors high-quality, durable household goods with smart-tech integration over budget-friendly manual alternatives"
        },
        "preferences_state:shared_activity_planning": {
          "from": {
            "statement": "Prefers scheduled, structured family bonding activities over spontaneous or unstructured leisure time"
          },
          "to": {
            "statement": "Strongly prefers scheduled, technology-facilitated family activities that ensure consistent participation from the teenagers"
          }
        },
        "preferences_state:social_interaction_format": {
          "statement": "Prefers in-person social interactions over digital or virtual gatherings for building deep community bonds"
        },
        "user_attributes_state:community_memberships": "American Coatings Association (industry-focused professional networking community)",
        "user_attributes_state:home_infrastructure_assets": "Ring Video Doorbell Pro 2 (Hardwired security monitoring for main entry)",
        "user_attributes_state:industry_software_skills": "Microsoft Project (advanced level for timeline and resource management)",
        "user_attributes_state:insurance_portfolio": "State Farm Umbrella Policy ($1M liability coverage for personal asset protection)",
        "user_attributes_state:leisure_hardware": "SawStop Professional Cabinet Saw (high-end safety-focused table saw for precision woodworking)",
        "user_attributes_state:main_investment_account": "Vanguard Personal Advisor Services (Managed brokerage account focused on diversified ETFs)",
        "user_attributes_state:main_tech_tool": "SAP ERP (system used for project tracking, resource allocation, and budget management)",
        "user_attributes_state:primary_family_vehicle": "2022 Honda Odyssey (Main vehicle for carpooling and family errands)",
        "user_attributes_state:primary_health_focus": {
          "from": "Maintenance of cardiovascular health and managing lower back stiffness from desk work",
          "to": "Developing core and posterior chain strength to permanently resolve sedentary-related back pain"
        },
        "user_attributes_state:primary_residence_mortgage": "15-year fixed-rate mortgage through Rocket Mortgage (2.875% APR, $2,450 monthly payment)",
        "user_attributes_state:professional_certifications": "EPA Environmental Compliance Certification for Industrial Coatings (focused on VOC regulation and reporting)",
        "user_attributes_state:professional_memberships": "Association for Materials Protection and Performance (AMPP, national member)",
        "user_attributes_state:recovery_tools": "Bowflex SelectTech 552 (Adjustable dumbbells for home-based resistance training)",
        "user_attributes_state:social_digital_platforms": "Facebook (private account for keeping in touch with extended family and high school friends)",
        "user_attributes_state:travel_equipment": "Set of 4 hard-shell Samsonite suitcases"
      }
    }
  ],
  "research_frame_version": "rq_v2",
  "task_contract_version": "taskabc_v2"
}
JSON
